import { useEffect } from 'react';
import { create } from 'zustand';
import { Modal } from './ui';
import { useAssistText } from './strings';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function raw(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* Non-JSON response. */
    }
    throw new ApiError(message || `HTTP ${response.status}`, response.status);
  }
  return response;
}
const session = new URLSearchParams(location.hash.slice(1)).get('mio-session') || '';
export function notifyHost(type: string, extra: Record<string, unknown> = {}) {
  if (parent !== window)
    parent.postMessage({ type: `mio:workspace:${type}`, session, ...extra }, location.origin);
}
export function useNavigate() {
  return (path: string) => notifyHost('navigate', { path });
}

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
};
const confirmations = create<{
  pending: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}>(() => ({ pending: null }));
export function confirm(options: ConfirmOptions): Promise<boolean> {
  confirmations.getState().pending?.resolve(false);
  return new Promise((resolve) => confirmations.setState({ pending: { ...options, resolve } }));
}
export function ConfirmHost() {
  const pending = confirmations((s) => s.pending);
  const text = useAssistText();
  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    confirmations.setState({ pending: null });
  };
  return pending ? (
    <Modal
      open
      onOpenChange={(open) => !open && settle(false)}
      title={pending.title}
      footer={
        <>
          <button className="btn" onClick={() => settle(false)}>
            {text('cancel')}
          </button>
          <button className={`btn ${pending.danger ? 'danger' : ''}`} onClick={() => settle(true)}>
            {pending.confirmLabel || text('allow')}
          </button>
        </>
      }
    >
      {pending.description}
    </Modal>
  ) : null;
}
const messages = create<{ text: string }>(() => ({ text: '' }));
export function toast(text: string) {
  messages.setState({ text });
}
export function toastError(error: unknown) {
  toast(error instanceof Error ? error.message : String(error));
}
export function Toaster() {
  const text = messages((state) => state.text);
  useEffect(() => {
    if (text) {
      const timer = setTimeout(() => messages.setState({ text: '' }), 4000);
      return () => clearTimeout(timer);
    }
  }, [text]);
  return text ? (
    <div className="toast" role="status">
      {text}
    </div>
  ) : null;
}
