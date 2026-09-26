import { create } from 'zustand';
import { ApiError } from '../api/client';

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface ToastState {
  items: Toast[];
  push: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (text, kind = 'info') => {
    const id = ++seq;
    set({ items: [...get().items.slice(-3), { id, text, kind }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : 3500);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = (text: string) => useToasts.getState().push(text);

export function toastError(error: unknown): void {
  const text =
    error instanceof ApiError || error instanceof Error ? error.message : String(error ?? '');
  useToasts.getState().push(text || 'Error', 'error');
}

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
