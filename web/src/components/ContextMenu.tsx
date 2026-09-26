import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface ContextItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Shown right-aligned, e.g. "Del" or "Ctrl+D". */
  shortcut?: string;
}

/** Items separated by thin rules; a heading (optional) names the group. */
export interface ContextGroup {
  heading?: ReactNode;
  items: ContextItem[];
}

export interface ContextMenuState<T> {
  x: number;
  y: number;
  payload: T;
}

/** Right-click menu state: `open(event, payload)` from an onContextMenu handler. */
export function useContextMenu<T>() {
  const [state, setState] = useState<ContextMenuState<T> | null>(null);
  return {
    state,
    open: (e: MouseEvent, payload: T) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ x: e.clientX, y: e.clientY, payload });
    },
    close: () => setState(null),
  };
}

/**
 * Positioned menu rendered in a portal; closes on Escape, outside click, scroll or resize.
 * Keyboard: ↑ ↓ move, Enter / Space activate.
 */
export function ContextMenu(props: {
  x: number;
  y: number;
  groups: ContextGroup[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  const { onClose } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(props.x, window.innerWidth - width - 4));
    const top = Math.max(4, Math.min(props.y, window.innerHeight - height - 4));
    setPos({ left, top });
    (el.querySelector('[role=menuitem]:not([aria-disabled=true])') as HTMLElement | null)?.focus();
  }, [props.x, props.y]);

  useEffect(() => {
    const down = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            '[role=menuitem]:not([aria-disabled=true])',
          ) ?? []),
        ];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const groups = props.groups.filter((g) => g.items.length);
  return createPortal(
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 60 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {groups.map((g, gi) => (
        <div key={gi} className="context-group">
          {g.heading ? <div className="context-heading">{g.heading}</div> : null}
          {g.items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`menu-item ${item.danger ? 'danger' : ''}`}
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onClose();
                item.onSelect();
              }}
            >
              {item.icon}
              <span className="grow">{item.label}</span>
              {item.shortcut ? <kbd className="context-shortcut">{item.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
