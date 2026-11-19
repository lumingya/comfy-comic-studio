import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, MousePointer2, Puzzle } from 'lucide-react';
import { raw } from '../api/client';
import { Loading } from '../components/ui';
import { QueryError } from '../app/errors';
import {
  useExtensionPreferences,
  useSaveExtensionPreferences,
  type FloatingPosition,
} from '../api/open';
import { toastError } from '../components/toast';
import { dispatchByPriority, type ExtensionEventDecision } from './eventPipeline';
import './host.css';

export interface WorkspaceSurface {
  extension_id: string;
  id: string;
  title: string;
  mode: 'floating' | 'page';
  url: string;
  priority?: number;
  global?: boolean;
  transparent?: boolean;
  default_position?: FloatingPosition;
  activation?: string;
  digest?: string;
}

type WorkspaceEventSubscription = {
  surface: WorkspaceSurface;
  frame: HTMLIFrameElement;
  session: string;
  event: 'keydown';
};

type WorkspaceEventCallbacks = {
  onSubscribe?: (subscription: WorkspaceEventSubscription, enabled: boolean) => void;
  onEventResult?: (
    eventId: string,
    decision: ExtensionEventDecision,
    frame: HTMLIFrameElement,
    session: string,
  ) => void;
  active?: boolean;
};
export function useWorkspaceSurfaces() {
  return useQuery({
    queryKey: ['extension-surfaces'],
    queryFn: async () =>
      (await raw('/api/extension-surfaces')).json() as Promise<{ items: WorkspaceSurface[] }>,
    retry: false,
  });
}

/** Reviewed application extensions run their own built assets; the host never imports their code. */
function WorkspaceFrame({
  surface,
  floating,
  clickThrough = false,
  position,
  onResize,
  onClickThrough,
  onSubscribe,
  onEventResult,
  active = true,
  focused = false,
}: {
  surface: WorkspaceSurface;
  floating: boolean;
  clickThrough?: boolean;
  position?: { x: number; y: number };
  onResize?: (width: number, height: number) => void;
  onClickThrough?: (enabled: boolean) => void;
  focused?: boolean;
} & WorkspaceEventCallbacks) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [session] = useState(() => crypto.randomUUID());
  const subscriptions = useRef(new Set<'keydown'>());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const latest = useRef({
    surface,
    floating,
    onResize,
    onClickThrough,
    onSubscribe,
    onEventResult,
    active,
    navigate,
  });
  latest.current = {
    surface,
    floating,
    onResize,
    onClickThrough,
    onSubscribe,
    onEventResult,
    active,
    navigate,
  };
  const context = () => {
    const style = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Array.from({ length: style.length }, (_, index) => style.item(index))
        .filter((key) => key.startsWith('--'))
        .map((key) => [key, style.getPropertyValue(key)]),
    );
    return {
      type: 'mio:workspace:context',
      session,
      tokens,
      theme: document.documentElement.dataset.theme,
      locale: document.documentElement.lang || 'zh-CN',
      floating: latest.current.floating,
    };
  };
  useEffect(() => {
    const ownedFrame = frame.current;
    const send = () => frame.current?.contentWindow?.postMessage(context(), location.origin);
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== session
      )
        return;
      if (event.data.type === 'mio:workspace:ready') send();
      if (event.data.type === 'mio:workspace:changed') void qc.invalidateQueries();
      if (
        event.data.type === 'mio:workspace:resize' &&
        Number.isFinite(event.data.width) &&
        Number.isFinite(event.data.height)
      )
        latest.current.onResize?.(
          Math.max(240, Math.min(1200, Math.round(event.data.width))),
          Math.max(200, Math.min(1000, Math.round(event.data.height))),
        );
      if (
        event.data.type === 'mio:workspace:click-through' &&
        typeof event.data.enabled === 'boolean'
      )
        latest.current.onClickThrough?.(event.data.enabled);
      if (
        event.data.type === 'mio:workspace:listen' &&
        event.data.event === 'keydown' &&
        typeof event.data.enabled === 'boolean'
      ) {
        if (event.data.enabled) subscriptions.current.add('keydown');
        else subscriptions.current.delete('keydown');
        const currentFrame = frame.current;
        if (currentFrame)
          latest.current.onSubscribe?.(
            { surface: latest.current.surface, frame: currentFrame, session, event: 'keydown' },
            event.data.enabled && latest.current.active,
          );
      }
      if (
        event.data.type === 'mio:workspace:event-result' &&
        typeof event.data.eventId === 'string'
      ) {
        const decision = event.data.action;
        if (frame.current)
          latest.current.onEventResult?.(
            event.data.eventId,
            decision === 'handled' || decision === 'stop_propagation' ? decision : 'continue',
            frame.current,
            session,
          );
      }
      if (
        event.data.type === 'mio:workspace:navigate' &&
        [
          '/',
          `/extensions/${latest.current.surface.extension_id}`,
          '/extensions?tab=installed',
          '/settings?tab=extensions',
        ].includes(event.data.path)
      )
        latest.current.navigate(event.data.path);
    };
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'lang', 'data-font-scale', 'data-density'],
    });
    window.addEventListener('message', listener);
    return () => {
      observer.disconnect();
      window.removeEventListener('message', listener);
      if (ownedFrame)
        for (const event of subscriptions.current)
          latest.current.onSubscribe?.(
            { surface: latest.current.surface, frame: ownedFrame, session, event },
            false,
          );
      subscriptions.current.clear();
    };
  }, [qc, session]);
  useEffect(() => {
    const currentFrame = frame.current;
    if (!currentFrame || !onSubscribe) return;
    for (const event of subscriptions.current)
      onSubscribe({ surface: latest.current.surface, frame: currentFrame, session, event }, active);
    return () => {
      for (const event of subscriptions.current)
        onSubscribe(
          { surface: latest.current.surface, frame: currentFrame, session, event },
          false,
        );
    };
  }, [active, onSubscribe, session]);
  const visibility = useRef<boolean | undefined>(undefined);
  const focus = useRef(false);
  const notifyLifecycle = () => {
    const send = (state: 'shown' | 'hidden' | 'focused' | 'blurred') =>
      frame.current?.contentWindow?.postMessage(
        { type: 'mio:workspace:lifecycle', session, state },
        location.origin,
      );
    if (focus.current && (!active || !focused)) {
      send('blurred');
      focus.current = false;
    }
    if (visibility.current !== active) {
      send(active ? 'shown' : 'hidden');
      visibility.current = active;
    }
    if (active && focused && !focus.current) {
      send('focused');
      focus.current = true;
    }
  };
  useEffect(notifyLifecycle, [active, focused, session]);
  useEffect(() => {
    if (!position) return;
    frame.current?.contentWindow?.postMessage(
      { type: 'mio:workspace:moved', session, position },
      location.origin,
    );
  }, [position, session]);
  return (
    <iframe
      ref={frame}
      className="workspace-extension-frame"
      title={surface.title}
      sandbox="allow-scripts allow-same-origin allow-downloads"
      referrerPolicy="no-referrer"
      src={`${surface.url}#mio-session=${session}&floating=${floating ? '1' : '0'}`}
      style={{ pointerEvents: clickThrough ? 'none' : undefined }}
      onLoad={() => {
        const currentFrame = frame.current;
        if (currentFrame)
          for (const event of subscriptions.current)
            latest.current.onSubscribe?.(
              { surface: latest.current.surface, frame: currentFrame, session, event },
              false,
            );
        subscriptions.current.clear();
        visibility.current = undefined;
        focus.current = false;
        currentFrame?.contentWindow?.postMessage(context(), location.origin);
        notifyLifecycle();
      }}
    />
  );
}

export function WorkspaceExtensionPage() {
  const { t } = useTranslation();
  const { extensionId, surfaceId } = useParams();
  const surfaces = useWorkspaceSurfaces();
  if (surfaces.isPending) return <Loading />;
  if (surfaces.isError) return <QueryError error={surfaces.error} onRetry={surfaces.refetch} />;
  const surface = surfaces.data?.items
    .filter((item) => item.extension_id === extensionId && (!surfaceId || item.id === surfaceId))
    .sort(compareSurfaces)[0];
  if (!surface)
    return (
      <div className="empty">
        <Link className="btn" to="/extensions?tab=installed">
          <Puzzle size={18} />
          {t('settings.tabs.extensions')}
        </Link>
      </div>
    );
  return (
    <div className="workspace-extension-page">
      <WorkspaceFrame key={surfaceIdentity(surface)} surface={surface} floating={false} />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareSurfaces(left: WorkspaceSurface, right: WorkspaceSurface): number {
  return (
    (right.priority ?? 0) - (left.priority ?? 0) ||
    left.extension_id.localeCompare(right.extension_id) ||
    left.id.localeCompare(right.id)
  );
}

function surfaceIdentity(surface: WorkspaceSurface): string {
  return JSON.stringify([
    surface.extension_id,
    surface.id,
    surface.url,
    surface.activation,
    surface.digest,
  ]);
}

function subscriptionKey(subscription: WorkspaceEventSubscription): string {
  return `${subscription.surface.extension_id}:${subscription.surface.id}:${subscription.event}`;
}

function FloatingSurface({
  surface,
  index,
  visible,
  onSubscribe,
  onEventResult,
}: {
  surface: WorkspaceSurface;
  index: number;
  visible: boolean;
  onSubscribe: WorkspaceEventCallbacks['onSubscribe'];
  onEventResult: WorkspaceEventCallbacks['onEventResult'];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const positionRef = useRef(position);
  positionRef.current = position;
  const [size, setSize] = useState({ width: 480, height: 560 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [clickThrough, setClickThrough] = useState(false);
  const clickThroughRef = useRef(clickThrough);
  clickThroughRef.current = clickThrough;
  const initialized = useRef(false);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const preferences = useExtensionPreferences(surface.extension_id);
  const savePreferences = useSaveExtensionPreferences(surface.extension_id);
  const queryClient = useQueryClient();
  const live = useRef(true);
  const writeSequence = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const anchor = surface.default_position ?? {
    x: 'right' as const,
    y: 'bottom' as const,
    offset: [24 + index * 24, 50] as [number, number],
  };
  const baseStyle = useMemo(
    () => ({
      left:
        typeof anchor.x === 'number'
          ? anchor.x
          : anchor.x === 'left'
            ? anchor.offset[0]
            : undefined,
      right: anchor.x === 'right' ? anchor.offset[0] : undefined,
      top:
        typeof anchor.y === 'number' ? anchor.y : anchor.y === 'top' ? anchor.offset[1] : undefined,
      bottom: anchor.y === 'bottom' ? anchor.offset[1] : undefined,
    }),
    [anchor.x, anchor.y, anchor.offset],
  );
  const persist = (
    nextPosition = positionRef.current,
    nextSize = sizeRef.current,
    nextClickThrough = clickThroughRef.current,
  ) => {
    initialized.current = true;
    const sequence = ++writeSequence.current;
    savePreferences.mutate(
      {
        path: ['floating_surfaces', surface.id],
        value: { position: nextPosition, size: nextSize, clickThrough: nextClickThrough },
      },
      {
        onError: (error) => {
          if (live.current && sequence === writeSequence.current) {
            const current = queryClient.getQueryData<Record<string, unknown>>([
              'extension-preferences',
              surface.extension_id,
            ]);
            restore(current ?? {});
            toastError(error);
          }
        },
      },
    );
  };
  const boundedSize = (width: number, height: number) => {
    const availableWidth = Math.max(1, innerWidth - 24);
    const availableHeight = Math.max(1, innerHeight - 60);
    return {
      width: Math.max(Math.min(240, availableWidth), Math.min(1200, availableWidth, width)),
      height: Math.max(Math.min(200, availableHeight), Math.min(1000, availableHeight, height)),
    };
  };
  const resize = (width: number, height: number) => {
    const next = boundedSize(width, height);
    sizeRef.current = next;
    setSize(next);
    persist(positionRef.current, next);
  };
  const setPassThrough = (enabled: boolean) => {
    clickThroughRef.current = enabled;
    setClickThrough(enabled);
    persist(positionRef.current, sizeRef.current, enabled);
  };
  const restore = (value: Record<string, unknown>) => {
    const all = isRecord(value.floating_surfaces) ? value.floating_surfaces : {};
    const rawSaved = all[surface.id];
    const saved = isRecord(rawSaved) ? rawSaved : {};
    positionRef.current = { x: 0, y: 0 };
    sizeRef.current = boundedSize(480, 560);
    clickThroughRef.current = false;
    const savedPosition = saved.position;
    if (isRecord(savedPosition)) {
      const x = savedPosition.x;
      const y = savedPosition.y;
      if (
        typeof x === 'number' &&
        typeof y === 'number' &&
        Number.isFinite(x) &&
        Number.isFinite(y)
      ) {
        positionRef.current = { x, y };
      }
    }
    const savedSize = saved.size;
    if (isRecord(savedSize)) {
      const width = savedSize.width;
      const height = savedSize.height;
      if (
        typeof width === 'number' &&
        typeof height === 'number' &&
        Number.isFinite(width) &&
        Number.isFinite(height)
      ) {
        sizeRef.current = boundedSize(width, height);
      }
    }
    if (typeof saved.clickThrough === 'boolean') {
      clickThroughRef.current = saved.clickThrough;
    }
    setPosition(positionRef.current);
    setSize(sizeRef.current);
    setClickThrough(clickThroughRef.current);
  };
  useEffect(() => {
    if (!preferences.isSuccess || initialized.current) return;
    restore(preferences.data);
    initialized.current = true;
  }, [preferences.data, preferences.isSuccess, surface.id]);
  const clamp = useCallback(() => {
    const rect = panel.current?.getBoundingClientRect();
    if (!rect || !open || !visible || rect.width <= 0 || rect.height <= 0) return;
    const current = positionRef.current;
    const next = {
      x:
        current.x +
        (rect.width > innerWidth
          ? -rect.left
          : Math.max(0, -rect.left) - Math.max(0, rect.right - innerWidth)),
      y:
        current.y +
        (rect.height > innerHeight
          ? -rect.top
          : Math.max(0, -rect.top) - Math.max(0, rect.bottom - innerHeight)),
    };
    if (next.x !== current.x || next.y !== current.y) {
      positionRef.current = next;
      setPosition(next);
    }
  }, [open, visible]);
  useLayoutEffect(() => {
    clamp();
  });
  useEffect(() => {
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [clamp]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setFocused(false);
    };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, []);
  useEffect(() => {
    if (!open || !visible) setFocused(false);
  }, [open, visible]);
  return (
    <>
      {visible && !open && (
        <button
          className="btn workspace-extension-launcher"
          style={{ bottom: 50 + index * 48 }}
          onClick={() => setOpen(true)}
        >
          <Puzzle size={18} />
          {surface.title}
        </button>
      )}
      <div
        ref={panel}
        className="workspace-extension-floating"
        hidden={!open || !visible}
        onPointerDownCapture={() => setFocused(true)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setFocused(false);
        }}
        onPointerUp={() => {
          const rect = panel.current?.getBoundingClientRect();
          if (
            rect &&
            (Math.abs(rect.width - size.width) > 1 || Math.abs(rect.height - size.height) > 1)
          )
            resize(rect.width, rect.height);
        }}
        style={{
          ...baseStyle,
          width: size.width,
          height: size.height,
          transform: `translate(${position.x}px, ${position.y}px)`,
          zIndex: Math.max(1, Math.min(10000, 500 + (surface.priority ?? 0))),
          pointerEvents: clickThrough ? 'none' : undefined,
          resize: clickThrough ? 'none' : undefined,
        }}
        data-transparent={surface.transparent ? 'true' : undefined}
        data-click-through={clickThrough ? 'true' : undefined}
      >
        <header
          className="workspace-extension-handle"
          style={{ pointerEvents: clickThrough ? 'auto' : undefined }}
          onPointerDown={(event) => {
            if ((event.target as Element).closest('button,a')) return;
            drag.current = { x: event.clientX, y: event.clientY, dx: position.x, dy: position.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || !panel.current) return;
            const rect = panel.current.getBoundingClientRect();
            const next = {
              x: Math.min(
                position.x + innerWidth - rect.right,
                Math.max(position.x - rect.left, drag.current.dx + event.clientX - drag.current.x),
              ),
              y: Math.min(
                position.y + innerHeight - rect.bottom,
                Math.max(position.y - rect.top, drag.current.dy + event.clientY - drag.current.y),
              ),
            };
            positionRef.current = next;
            setPosition(next);
          }}
          onPointerUp={() => {
            drag.current = null;
            persist();
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <span>{surface.title}</span>
          <span className="spacer" />
          <button
            className={`btn ghost icon sm ${clickThrough ? 'active' : ''}`}
            aria-label={t(
              clickThrough ? 'settings.ext.clickThroughOff' : 'settings.ext.clickThroughOn',
            )}
            aria-pressed={clickThrough}
            onClick={() => setPassThrough(!clickThrough)}
          >
            <MousePointer2 size={14} />
          </button>
          <Link
            className="btn ghost icon sm"
            to={`/extensions/${surface.extension_id}/${surface.id}`}
            aria-label={t('settings.ext.expand')}
          >
            <Maximize2 size={14} />
          </Link>
          <button
            className="btn ghost icon sm"
            aria-label={t('settings.ext.minimize')}
            onClick={() => setOpen(false)}
          >
            <Minimize2 size={14} />
          </button>
        </header>
        <WorkspaceFrame
          surface={surface}
          floating
          active={open && visible}
          focused={focused}
          clickThrough={clickThrough}
          position={position}
          onResize={resize}
          onClickThrough={setPassThrough}
          onSubscribe={onSubscribe}
          onEventResult={onEventResult}
        />
      </div>
    </>
  );
}
export function WorkspaceExtensionOverlays({ path }: { path: string }) {
  const surfaces = useWorkspaceSurfaces();
  const subscribers = useRef(new Map<string, WorkspaceEventSubscription>());
  const pendingEvents = useRef(
    new Map<
      string,
      {
        subscription: WorkspaceEventSubscription;
        finish: (decision: ExtensionEventDecision) => void;
      }
    >(),
  );
  const ordered = [...(surfaces.data?.items ?? [])].sort(compareSurfaces);
  const onSubscribe = useCallback<NonNullable<WorkspaceEventCallbacks['onSubscribe']>>(
    (subscription, enabled) => {
      const key = subscriptionKey(subscription);
      if (enabled) subscribers.current.set(key, subscription);
      else {
        const current = subscribers.current.get(key);
        if (current?.frame === subscription.frame && current.session === subscription.session)
          subscribers.current.delete(key);
        for (const pending of pendingEvents.current.values()) {
          if (
            pending.subscription.frame === subscription.frame &&
            pending.subscription.session === subscription.session
          )
            pending.finish('continue');
        }
      }
    },
    [],
  );
  const onEventResult = useCallback<NonNullable<WorkspaceEventCallbacks['onEventResult']>>(
    (eventId, decision, frame, session) => {
      const pending = pendingEvents.current.get(eventId);
      if (pending?.subscription.frame === frame && pending.subscription.session === session)
        pending.finish(decision);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        ['Digit0', 'Numpad0'].includes(event.code)
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
      )
        return;
      const payload = {
        type: 'keydown',
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      };
      const listeners = [...subscribers.current.values()].filter(
        (subscription) => subscription.event === 'keydown',
      );
      void dispatchByPriority(
        listeners,
        (subscription) => subscription.surface.priority ?? 0,
        (subscription) => {
          const current = subscribers.current.get(subscriptionKey(subscription));
          if (current?.frame !== subscription.frame || current.session !== subscription.session)
            return Promise.resolve('continue');
          const eventId = crypto.randomUUID();
          return new Promise<ExtensionEventDecision>((resolve) => {
            const timeout = window.setTimeout(() => {
              pendingEvents.current.delete(eventId);
              resolve('continue');
            }, 250);
            pendingEvents.current.set(eventId, {
              subscription,
              finish: (decision) => {
                window.clearTimeout(timeout);
                pendingEvents.current.delete(eventId);
                resolve(decision);
              },
            });
            subscription.frame.contentWindow?.postMessage(
              {
                type: 'mio:workspace:event',
                eventId,
                session: subscription.session,
                event: payload,
              },
              location.origin,
            );
          });
        },
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      for (const pending of pendingEvents.current.values()) pending.finish('continue');
      pendingEvents.current.clear();
      subscribers.current.clear();
    };
  }, []);
  return (
    <>
      {ordered
        .filter((item) => {
          if (item.mode !== 'floating') return false;
          return item.global !== false;
        })
        .map((surface, index) => (
          <FloatingSurface
            key={surfaceIdentity(surface)}
            surface={surface}
            index={index}
            visible={
              path !== `/extensions/${surface.extension_id}` &&
              path !== `/extensions/${surface.extension_id}/${surface.id}`
            }
            onSubscribe={onSubscribe}
            onEventResult={onEventResult}
          />
        ))}
    </>
  );
}
