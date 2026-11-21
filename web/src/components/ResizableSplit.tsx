import {
  cloneElement,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/split.css';

const GUTTER = 24;
const MOBILE_WIDTH = 760;
const storageName = (key: string) => `mio.split.${key}`;

function readWidth(key: string, fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(storageName(key)));
    return Number.isFinite(saved) && saved > 0 ? saved : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, width: number) {
  try {
    localStorage.setItem(storageName(key), String(width));
  } catch {
    // Storage may be unavailable; resizing still works for this visit.
  }
}

/** A list/detail split. Stored preference survives temporary container or viewport constraints. */
export function ResizableSplit({
  children,
  className = '',
  storageKey,
  label,
  defaultWidth = 218,
  minPrimary = 170,
  maxPrimary = 560,
  minSecondary = 360,
  ref,
}: {
  children: [ReactElement<{ id?: string }>, ReactNode];
  className?: string;
  storageKey: string;
  label: string;
  defaultWidth?: number;
  minPrimary?: number;
  maxPrimary?: number;
  minSecondary?: number;
  ref?: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => root.current!);
  const id = useId();
  const primaryId = children[0].props.id ?? `${id}-primary`;
  const [preferred, setPreferred] = useState(() => readWidth(storageKey, defaultWidth));
  const [size, setSize] = useState({ width: 0, mobile: window.innerWidth <= MOBILE_WIDTH });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointer: number;
    startX: number;
    startWidth: number;
    original: number;
    latest: number;
  } | null>(null);
  const stacked =
    size.mobile || (size.width > 0 && size.width < minPrimary + minSecondary + GUTTER);
  const maximum = Math.max(
    minPrimary,
    Math.min(maxPrimary, size.width ? size.width - minSecondary - GUTTER : maxPrimary),
  );
  const clamp = (value: number) => Math.round(Math.max(minPrimary, Math.min(maximum, value)));
  const width = clamp(preferred);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const mobile = window.innerWidth <= MOBILE_WIDTH;
      setSize((previous) =>
        previous.width === width && previous.mobile === mobile ? previous : { width, mobile },
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const stop = (cancel = false) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    setDragging(false);
    if (cancel) setPreferred(active.original);
    else remember(storageKey, active.latest);
    if (handle.current?.hasPointerCapture?.(active.pointer))
      handle.current.releasePointerCapture(active.pointer);
  };

  useLayoutEffect(() => {
    if (stacked) stop(true);
  }, [stacked]);

  const change = (value: number) => {
    const next = clamp(value);
    setPreferred(next);
    remember(storageKey, next);
  };
  const reset = () => {
    stop(true);
    setPreferred(defaultWidth);
    remember(storageKey, defaultWidth);
  };

  return (
    <div
      ref={root}
      className={`resizable-split ${className}`}
      data-stacked={stacked || undefined}
      data-resizing={dragging || undefined}
      style={{ '--split-primary': `${width}px`, '--split-gutter': `${GUTTER}px` } as CSSProperties}
    >
      {cloneElement(children[0], { id: primaryId })}
      <div
        ref={handle}
        className="split-handle"
        role="separator"
        aria-label={t('common.resizePanel', { name: label })}
        aria-describedby={`${id}-hint`}
        aria-controls={primaryId}
        aria-orientation="vertical"
        aria-valuemin={minPrimary}
        aria-valuemax={maximum}
        aria-valuenow={width}
        aria-valuetext={t('common.panelWidth', { width })}
        tabIndex={stacked ? -1 : 0}
        hidden={stacked}
        title={t('common.resizeHint')}
        onDoubleClick={reset}
        onPointerDown={(event) => {
          if (event.button !== 0 || stacked || drag.current) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus();
          drag.current = {
            pointer: event.pointerId,
            startX: event.clientX,
            startWidth: width,
            original: preferred,
            latest: width,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId) return;
          active.latest = clamp(active.startWidth + event.clientX - active.startX);
          setPreferred(active.latest);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer === event.pointerId) stop();
        }}
        onPointerCancel={(event) => {
          if (drag.current?.pointer === event.pointerId) stop(true);
        }}
        onLostPointerCapture={() => stop()}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing)
            return;
          const step = event.shiftKey ? 40 : 10;
          switch (event.key) {
            case 'ArrowLeft':
              change(width - step);
              break;
            case 'ArrowRight':
              change(width + step);
              break;
            case 'Home':
              change(minPrimary);
              break;
            case 'End':
              change(maximum);
              break;
            case 'Enter':
              reset();
              break;
            case 'Escape':
              if (!drag.current) return;
              stop(true);
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <span id={`${id}-hint`} className="sr-only">
          {t('common.resizeHint')}
        </span>
      </div>
      {children[1]}
    </div>
  );
}
