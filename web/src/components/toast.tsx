import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { ApiError } from '../api/client';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: ToastAction;
  duration: number;
}

export interface ToastOptions {
  /** A button in the toast, e.g. "Undo" after a destructive action. */
  action?: ToastAction;
  /** Milliseconds before it hides (hovering pauses the timer). */
  duration?: number;
}

interface ToastState {
  items: Toast[];
  push: (text: string, kind?: Toast['kind'], options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  hold: (id: number) => void;
  release: (id: number) => void;
}

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function schedule(id: number, ms: number) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => useToasts.getState().dismiss(id), ms),
  );
}

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (text, kind = 'info', options = {}) => {
    const id = ++seq;
    const duration = options.duration ?? (options.action ? 6000 : kind === 'error' ? 7000 : 3500);
    set({
      items: [...get().items.slice(-3), { id, text, kind, action: options.action, duration }],
    });
    schedule(id, duration);
    return id;
  },
  dismiss: (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
    set({ items: get().items.filter((t) => t.id !== id) });
  },
  hold: (id) => clearTimeout(timers.get(id)),
  release: (id) => {
    if (get().items.some((t) => t.id === id)) schedule(id, 2500);
  },
}));

export const toast = (text: string, options?: ToastOptions) =>
  useToasts.getState().push(text, 'info', options);

export function toastError(error: unknown): void {
  const text =
    error instanceof ApiError || error instanceof Error ? error.message : String(error ?? '');
  useToasts.getState().push(text || 'Error', 'error');
}

export function Toaster() {
  const { t } = useTranslation();
  const { items, dismiss, hold, release } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.kind}`}
          role={item.kind === 'error' ? 'alert' : undefined}
          onMouseEnter={() => hold(item.id)}
          onMouseLeave={() => release(item.id)}
        >
          <span className="toast-icon" aria-hidden>
            {item.kind === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
          </span>
          <span className="toast-text">{item.text}</span>
          {item.action ? (
            <button
              className="toast-action"
              onClick={() => {
                item.action?.onClick();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            className="toast-close"
            aria-label={t('common.close')}
            onClick={() => dismiss(item.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
