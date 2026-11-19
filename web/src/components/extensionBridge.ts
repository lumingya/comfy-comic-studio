import type { ExtensionPanel } from '../api/open';
import {
  BRIDGE,
  type PanelContext as ContractPanelContext,
  type PanelBridgeRequest,
  type PanelBridgeResponse,
  type PanelFromFrame,
  type PanelToFrame,
} from '../api/extensionProtocol';

export const PANEL_REQUEST_LIMIT = BRIDGE.panel.limits.requestBytes;
export const PANEL_RESPONSE_LIMIT = BRIDGE.panel.limits.responseBytes;
const MAX_CONCURRENT = BRIDGE.panel.limits.concurrent;
const MAX_REQUEST_IDS = BRIDGE.panel.limits.requestIds;

export type PanelContext = ContractPanelContext;
export type PanelCall = PanelBridgeRequest;
export type PanelResult = PanelBridgeResponse;

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

  const envelope = { version: BRIDGE.panel.version, session };
  const reply = (message: PanelToFrame) => {
    if (!disposed) options.frame()?.postMessage(message, '*');
  };
  const error = (rid: string, status: number, detail: string) =>
    reply({
      ...envelope,
      type: BRIDGE.panel.types.response,
      rid,
      status,
      data: { detail },
      ok: false,
    });

  const handle = (event: MessageEvent) => {
    if (disposed || !options.frame() || event.source !== options.frame()) return;
    const message: unknown = event.data;
    if (!record(message) || message.version !== BRIDGE.panel.version || message.session !== session)
      return;
    if (message.type === BRIDGE.panel.types.ready) {
      ready = true;
      reply({
        ...envelope,
        type: BRIDGE.panel.types.init,
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
    if (!ready || message.type !== BRIDGE.panel.types.request) return;
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
    // Shape validation remains at the typed HTTP bridge; the frame supplies no headers or URL.
    const request = message as Extract<PanelFromFrame, { type: typeof BRIDGE.panel.types.request }>;
    const body: PanelCall = {
      activation: panel.activation,
      digest: panel.digest,
      request_id: declared.id,
      context,
      path_params: request.path_params,
      query: request.query,
      body: request.body,
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
            ...envelope,
            type: BRIDGE.panel.types.response,
            rid,
            ...result,
            data: result.data ?? null,
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
