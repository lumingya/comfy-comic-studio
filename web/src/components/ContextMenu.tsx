import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { topDialog } from './topLayer';

export interface ContextItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** The main action of the menu (bold, like the legacy `primary` item). */
  primary?: boolean;
  disabled?: boolean;
  /** Shown right-aligned, e.g. "Del" or "Ctrl+D". */
  shortcut?: string;
  /** One quiet line under the label: what the action does or why it is disabled. */
  hint?: ReactNode;
  /** Native tooltip (legacy `title`), e.g. the reason a disabled item cannot run. */
  title?: string;
}

/** Items separated by thin rules; a heading (optional) names the group, a note closes it. */
export interface ContextGroup {
  heading?: ReactNode;
  items: ContextItem[];
  /** Plain text after the items (legacy `{type:'label'}`), e.g. how to multi-select. */
  note?: ReactNode;
}

export interface ContextMenuState<T> {
  x: number;
  y: number;
  payload: T;
}

/** Right-click menu state: `open(event, payload)` from an onContextMenu handler. */
export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);
  const openAt = useCallback((x: number, y: number, payload: T) => setState({ x, y, payload }), []);
  const close = useCallback(() => setState(null), []);
  const open = useCallback(
    (e: MouseEvent, payload: T) => {
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY, payload);
    },
    [openAt],
  );
  return { state, open, openAt, close };
}

/**
 * Positioned menu rendered in a portal; closes on Escape, outside click, scroll or resize.
 * Keyboard: ↑ ↓ move, Enter / Space activate.
 */
export function ContextMenu(props: {
  x: number;
  y: number;
  /** Legacy ctx-title: what the menu acts on, with one quiet line of facts under it. */
  title?: ReactNode;
  subtitle?: ReactNode;
  groups: ContextGroup[];
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(performance.now());
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const { onClose, returnFocus } = props;
  const previousFocus = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(props.x, window.innerWidth - width - 4));
    const top = Math.max(4, Math.min(props.y, window.innerHeight - height - 4));
    setPos({ left, top });
    (el.querySelector('[role=menuitem]:not([aria-disabled=true])') as HTMLElement | null)?.focus({
      preventScroll: true,
    });
  }, [props.x, props.y]);

  useEffect(() => {
    const down = (e: globalThis.MouseEvent) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const target = returnFocus ?? previousFocus.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        onClose();
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            '[role=menuitem]:not([aria-disabled=true])',
          ) ?? []),
        ];
        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : e.key === 'ArrowDown'
                ? (i + 1) % items.length
                : (i - 1 + items.length) % items.length;
        items[next].focus({ preventScroll: true });
      }
    };
    const scroll = (e: Event) => {
      if (
        performance.now() - openedAt.current > 250 &&
        !(e.target instanceof Node && ref.current?.contains(e.target))
      )
        onClose();
    };
    document.addEventListener('mousedown', down, true);
    window.addEventListener('wheel', down, { passive: true });
    window.addEventListener('touchmove', scroll, { passive: true });
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('wheel', down);
      window.removeEventListener('touchmove', scroll);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, returnFocus]);

  const groups = props.groups.filter((g) => g.items.length || g.note);
  return createPortal(
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        zIndex: 110,
        maxHeight: 'calc(100dvh - 8px)',
        overflowY: 'auto',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.title ? (
        <div className="context-title">
          <strong>{props.title}</strong>
          {props.subtitle ? <small>{props.subtitle}</small> : null}
        </div>
      ) : null}
      {groups.map((g, gi) => (
        <div key={gi} className="context-group">
          {g.heading ? <div className="context-heading">{g.heading}</div> : null}
          {g.items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`menu-item ${item.danger ? 'danger' : ''} ${item.primary ? 'primary' : ''}`}
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                if (item.disabled) return;
                onClose();
                item.onSelect();
              }}
            >
              {item.icon}
              <span className="grow context-text">
                <span>{item.label}</span>
                {item.hint ? <small className="context-hint">{item.hint}</small> : null}
              </span>
              {item.shortcut ? <kbd className="context-shortcut">{item.shortcut}</kbd> : null}
            </button>
          ))}
          {g.note ? <div className="context-note">{g.note}</div> : null}
        </div>
      ))}
    </div>,
    topDialog() ?? document.body,
  );
}
