import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, MousePointer2, Puzzle } from 'lucide-react';
import { useExtensionPreferences, useSaveExtensionPreferences } from '../api/open';
import { toastError } from '../components/toast';
import { isRecord, type WorkspaceSurface, type WorkspaceEventCallbacks } from './hostSurfaces';
import { WorkspaceFrame } from './hostFrame';

export function FloatingSurface({
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
