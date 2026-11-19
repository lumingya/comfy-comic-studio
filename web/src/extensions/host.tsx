import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, MousePointer2, Puzzle } from 'lucide-react';
import { raw } from '../api/client';
import { Loading } from '../components/ui';
import { QueryError } from '../app/errors';
import type { FloatingPosition } from '../api/open';
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
}

type WorkspaceEventSubscription = {
  surface: WorkspaceSurface;
  frame: HTMLIFrameElement;
  session: string;
  event: 'keydown';
};

type WorkspaceEventCallbacks = {
  onSubscribe?: (subscription: WorkspaceEventSubscription, enabled: boolean) => void;
  onEventResult?: (eventId: string, decision: ExtensionEventDecision) => void;
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
}: {
  surface: WorkspaceSurface;
  floating: boolean;
  clickThrough?: boolean;
  position?: { x: number; y: number };
  onResize?: (width: number, height: number) => void;
  onClickThrough?: (enabled: boolean) => void;
} & WorkspaceEventCallbacks) {
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef(crypto.randomUUID());
  const subscriptions = useRef(new Set<'keydown'>());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const context = () => {
    const style = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Array.from({ length: style.length }, (_, index) => style.item(index))
        .filter((key) => key.startsWith('--'))
        .map((key) => [key, style.getPropertyValue(key)]),
    );
    return {
      type: 'mio:workspace:context',
      session: session.current,
      tokens,
      theme: document.documentElement.dataset.theme,
      locale: document.documentElement.lang || 'zh-CN',
      floating,
    };
  };
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage(context(), location.origin);
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== session.current
      )
        return;
      if (event.data.type === 'mio:workspace:ready') send();
      if (event.data.type === 'mio:workspace:changed') void qc.invalidateQueries();
      if (
        event.data.type === 'mio:workspace:resize' &&
        Number.isFinite(event.data.width) &&
        Number.isFinite(event.data.height)
      )
        onResize?.(
          Math.max(240, Math.min(1200, Math.round(event.data.width))),
          Math.max(200, Math.min(1000, Math.round(event.data.height))),
        );
      if (
        event.data.type === 'mio:workspace:click-through' &&
        typeof event.data.enabled === 'boolean'
      )
        onClickThrough?.(event.data.enabled);
      if (
        event.data.type === 'mio:workspace:listen' &&
        event.data.event === 'keydown' &&
        typeof event.data.enabled === 'boolean'
      ) {
        if (event.data.enabled) subscriptions.current.add('keydown');
        else subscriptions.current.delete('keydown');
        const currentFrame = frame.current;
        if (currentFrame)
          onSubscribe?.(
            { surface, frame: currentFrame, session: session.current, event: 'keydown' },
            event.data.enabled && active,
          );
      }
      if (
        event.data.type === 'mio:workspace:event-result' &&
        typeof event.data.eventId === 'string'
      ) {
        const decision = event.data.action;
        onEventResult?.(
          event.data.eventId,
          decision === 'handled' || decision === 'stop_propagation' ? decision : 'continue',
        );
      }
      if (
        event.data.type === 'mio:workspace:navigate' &&
        [
          '/',
          `/extensions/${surface.extension_id}`,
          '/extensions?tab=installed',
          '/settings?tab=extensions',
        ].includes(event.data.path)
      )
        navigate(event.data.path);
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
      for (const subscribedEvent of subscriptions.current) {
        const currentFrame = frame.current;
        if (currentFrame)
          onSubscribe?.(
            { surface, frame: currentFrame, session: session.current, event: subscribedEvent },
            false,
          );
      }
      subscriptions.current.clear();
    };
  }, [
    surface,
    floating,
    qc,
    navigate,
    onResize,
    onClickThrough,
    onSubscribe,
    onEventResult,
    active,
  ]);
  useEffect(() => {
    const currentFrame = frame.current;
    if (!currentFrame || !onSubscribe) return;
    for (const event of subscriptions.current)
      onSubscribe({ surface, frame: currentFrame, session: session.current, event }, active);
  }, [active, onSubscribe, surface]);
  useEffect(() => {
    if (!position) return;
    frame.current?.contentWindow?.postMessage(
      { type: 'mio:workspace:moved', session: session.current, position },
      location.origin,
    );
  }, [position]);
  return (
    <iframe
      ref={frame}
      className="workspace-extension-frame"
      title={surface.title}
      sandbox="allow-scripts allow-same-origin allow-downloads"
      referrerPolicy="no-referrer"
      src={`${surface.url}#mio-session=${session.current}&floating=${floating ? '1' : '0'}`}
      style={{ pointerEvents: clickThrough ? 'none' : undefined }}
      onLoad={() => frame.current?.contentWindow?.postMessage(context(), location.origin)}
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
      <WorkspaceFrame surface={surface} floating={false} />
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

function FloatingSurface({
  surface,
  index,
  onSubscribe,
  onEventResult,
}: {
  surface: WorkspaceSurface;
  index: number;
  onSubscribe: WorkspaceEventCallbacks['onSubscribe'];
  onEventResult: WorkspaceEventCallbacks['onEventResult'];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const positionRef = useRef(position);
  positionRef.current = position;
  const [size, setSize] = useState({ width: 480, height: 560 });
  const [clickThrough, setClickThrough] = useState(false);
  const initialized = useRef(false);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const preferenceKey = ['extension-preferences', surface.extension_id] as const;
  const preferences = useQuery({
    queryKey: preferenceKey,
    queryFn: async () =>
      (
        await raw(`/api/ext/${encodeURIComponent(surface.extension_id)}/preferences`)
      ).json() as Promise<Record<string, unknown>>,
    retry: false,
  });
  const savePreferences = useMutation({
    mutationFn: async (value: Record<string, unknown>) =>
      (
        await raw(`/api/ext/${encodeURIComponent(surface.extension_id)}/preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        })
      ).json() as Promise<Record<string, unknown>>,
    onSuccess: (value) => queryClient.setQueryData(preferenceKey, value),
  });
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
    nextSize = size,
    nextClickThrough = clickThrough,
  ) => {
    const current = preferences.data ?? {};
    const surfaces = isRecord(current.floating_surfaces) ? current.floating_surfaces : {};
    const next = {
      ...current,
      floating_surfaces: {
        ...surfaces,
        [surface.id]: {
          position: nextPosition,
          size: nextSize,
          clickThrough: nextClickThrough,
        },
      },
    };
    savePreferences.mutate(next);
  };
  const resize = (width: number, height: number) => {
    const next = {
      width: Math.max(240, Math.min(1200, width)),
      height: Math.max(200, Math.min(1000, height)),
    };
    setSize(next);
    persist(positionRef.current, next);
  };
  const setPassThrough = (enabled: boolean) => {
    setClickThrough(enabled);
    persist(positionRef.current, size, enabled);
  };

  useEffect(() => {
    if (!preferences.isSuccess || initialized.current) return;
    const all = isRecord(preferences.data.floating_surfaces)
      ? preferences.data.floating_surfaces
      : {};
    const rawSaved = all[surface.id];
    const saved = isRecord(rawSaved) ? rawSaved : {};
    const savedPosition = saved.position;
    if (isRecord(savedPosition)) {
      const x = savedPosition.x;
      const y = savedPosition.y;
      if (typeof x === 'number' && typeof y === 'number') {
        positionRef.current = { x, y };
        setPosition(positionRef.current);
      }
    }
    const savedSize = saved.size;
    if (isRecord(savedSize)) {
      const width = savedSize.width;
      const height = savedSize.height;
      if (typeof width === 'number' && typeof height === 'number')
        setSize({
          width: Math.max(240, Math.min(1200, width)),
          height: Math.max(200, Math.min(1000, height)),
        });
    }
    if (typeof saved.clickThrough === 'boolean') setClickThrough(saved.clickThrough);
    initialized.current = true;
  }, [preferences.data, preferences.isSuccess, surface.id]);
  useEffect(() => {
    const clamp = () => {
      const rect = panel.current?.getBoundingClientRect();
      if (!rect || !open) return;
      setPosition((value) => ({
        x: value.x + Math.max(0, -rect.left) - Math.max(0, rect.right - innerWidth),
        y: value.y + Math.max(0, -rect.top) - Math.max(0, rect.bottom - innerHeight),
      }));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [open]);
  return (
    <>
      {!open && (
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
        hidden={!open}
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
        }}
        data-transparent={surface.transparent ? 'true' : undefined}
      >
        <header
          className="workspace-extension-handle"
          onPointerDown={(event) => {
            if ((event.target as Element).closest('button,a')) return;
            drag.current = { x: event.clientX, y: event.clientY, dx: position.x, dy: position.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || !panel.current) return;
            const rect = panel.current.getBoundingClientRect();
            setPosition({
              x: Math.min(
                position.x + innerWidth - rect.right,
                Math.max(position.x - rect.left, drag.current.dx + event.clientX - drag.current.x),
              ),
              y: Math.min(
                position.y + innerHeight - rect.bottom,
                Math.max(position.y - rect.top, drag.current.dy + event.clientY - drag.current.y),
              ),
            });
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
          active={open}
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
  const pendingEvents = useRef(new Map<string, (decision: ExtensionEventDecision) => void>());
  const ordered = [...(surfaces.data?.items ?? [])].sort(compareSurfaces);
  const onSubscribe = useCallback<NonNullable<WorkspaceEventCallbacks['onSubscribe']>>(
    (subscription, enabled) => {
      const key = `${subscription.surface.extension_id}:${subscription.surface.id}:${subscription.event}`;
      if (enabled) subscribers.current.set(key, subscription);
      else subscribers.current.delete(key);
    },
    [],
  );
  const onEventResult = useCallback<NonNullable<WorkspaceEventCallbacks['onEventResult']>>(
    (eventId, decision) => {
      pendingEvents.current.get(eventId)?.(decision);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
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
          const eventId = crypto.randomUUID();
          return new Promise<ExtensionEventDecision>((resolve) => {
            const timeout = window.setTimeout(() => {
              pendingEvents.current.delete(eventId);
              resolve('continue');
            }, 250);
            pendingEvents.current.set(eventId, (decision) => {
              window.clearTimeout(timeout);
              pendingEvents.current.delete(eventId);
              resolve(decision);
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
      for (const resolve of pendingEvents.current.values()) resolve('continue');
      pendingEvents.current.clear();
      subscribers.current.clear();
    };
  }, []);
  return (
    <>
      {ordered
        .filter((item) => {
          if (item.mode !== 'floating') return false;
          const owningPage =
            path === `/extensions/${item.extension_id}` ||
            path === `/extensions/${item.extension_id}/${item.id}`;
          return !owningPage && item.global !== false;
        })
        .map((surface, index) => (
          <FloatingSurface
            key={`${surface.extension_id}:${surface.id}`}
            surface={surface}
            index={index}
            onSubscribe={onSubscribe}
            onEventResult={onEventResult}
          />
        ))}
    </>
  );
}
