import type { ExtensionPanel } from '../api/open';

export const PANEL_REQUEST_LIMIT = 64 * 1024;
export const PANEL_RESPONSE_LIMIT = 1024 * 1024;
const MAX_CONCURRENT = 4;
const MAX_REQUEST_IDS = 256;

export interface PanelContext {
  episode_id?: string;
  series_id?: string;
}

export interface PanelCall {
  activation: string;
  digest: string;
  request_id: string;
  path_params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  context: PanelContext;
}

export interface PanelResult {
  status: number;
  data: unknown;
}

function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The nonce arrives in the initial frame URL fragment, never in a server log or API call.
 * A page navigated into the same opaque window cannot acquire a new nonce by asking for init.
 */
export function createPanelBridge(options: {
  panel: ExtensionPanel;
  session: string;
  context: PanelContext;
  frame: () => Window | null;
  request: (body: PanelCall, signal: AbortSignal) => Promise<PanelResult>;
  onMutation?: () => void;
}) {
  const { panel, session, context } = options;
  const pending = new Map<string, AbortController>();
  const seen = new Set<string>();
  let disposed = false;
  let ready = false;

  const reply = (message: Record<string, unknown>) => {
    if (!disposed) options.frame()?.postMessage({ version: 1, session, ...message }, '*');
  };
  const error = (rid: string, status: number, detail: string) =>
    reply({ type: 'mio:panel:response', rid, status, data: { detail }, ok: false });

  const handle = (event: MessageEvent) => {
    if (disposed || !options.frame() || event.source !== options.frame()) return;
    const message: unknown = event.data;
    if (!record(message) || message.version !== 1 || message.session !== session) return;
    if (message.type === 'mio:panel:ready') {
      ready = true;
      reply({
        type: 'mio:panel:init',
        context,
        requests: panel.requests ?? [],
        limits: {
          requestBytes: PANEL_REQUEST_LIMIT,
          responseBytes: PANEL_RESPONSE_LIMIT,
          concurrent: MAX_CONCURRENT,
        },
      });
      return;
    }
    if (!ready || message.type !== 'mio:panel:request') return;
    const { rid } = message;
    if (typeof rid !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(rid)) return;
    if (seen.has(rid)) {
      error(rid, 409, 'Request ID was already used; check the previous result.');
      return;
    }
    if (seen.size >= MAX_REQUEST_IDS || pending.size >= MAX_CONCURRENT) {
      error(rid, 429, 'Panel request limit reached.');
      return;
    }
    let size: number;
    try {
      size = jsonSize(message);
    } catch {
      error(rid, 400, 'Panel request must be JSON.');
      return;
    }
    if (size > PANEL_REQUEST_LIMIT) {
      error(rid, 413, 'Panel request exceeds 64 KiB.');
      return;
    }
    const declared = panel.requests?.find((item) => item.id === message.request_id);
    if (!declared || !panel.activation || !panel.digest) {
      error(rid, 403, 'Request was not declared by this panel.');
      return;
    }
    seen.add(rid);
    const controller = new AbortController();
    pending.set(rid, controller);
    const body: PanelCall = {
      activation: panel.activation,
      digest: panel.digest,
      request_id: declared.id,
      context,
      path_params: message.path_params as Record<string, string> | undefined,
      query: message.query as Record<string, unknown> | undefined,
      body: message.body,
    };
    void options
      .request(body, controller.signal)
      .then(
        (result) => {
          if (disposed || controller.signal.aborted) return;
          if (jsonSize(result) > PANEL_RESPONSE_LIMIT) {
            error(rid, 413, 'Panel response exceeds 1 MiB.');
            return;
          }
          reply({
            type: 'mio:panel:response',
            rid,
            ...result,
            ok: result.status >= 200 && result.status < 300,
          });
          if (result.status < 300 && declared.method !== 'GET') options.onMutation?.();
        },
        (cause: unknown) => {
          if (disposed || controller.signal.aborted) return;
          const failure = cause as { status?: number; message?: string };
          error(rid, failure.status ?? 500, failure.message ?? 'Panel request failed.');
        },
      )
      .finally(() => pending.delete(rid));
  };

  const abort = () => {
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
  return {
    handle,
    abort,
    dispose: () => {
      disposed = true;
      abort();
    },
  };
}
