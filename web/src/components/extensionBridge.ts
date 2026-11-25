import type { ExtensionPanel } from '../api/open';
import {
  BRIDGE,
  type PanelAppearance as ContractPanelAppearance,
  type PanelContext as ContractPanelContext,
  type PanelBridgeRequest,
  type PanelBridgeResponse,
  type PanelFromFrame,
  type PanelToFrame,
} from '../api/extensionProtocol';
import { createPanelMedia, type PanelBinary, type PanelDownload } from './extensionMedia';
import { readImageDimensions } from './imageHeader';

export const PANEL_REQUEST_LIMIT = BRIDGE.panel.limits.requestBytes;
export const PANEL_RESPONSE_LIMIT = BRIDGE.panel.limits.responseBytes;
const MAX_CONCURRENT = BRIDGE.panel.limits.concurrent;
const MAX_REQUEST_IDS = BRIDGE.panel.limits.requestIds;

export type PanelContext = ContractPanelContext;
export type PanelAppearance = ContractPanelAppearance;
export type PanelCall = PanelBridgeRequest;
export type PanelResult = PanelBridgeResponse;
export type PanelUploadCall = Pick<
  PanelCall,
  'activation' | 'digest' | 'request_id' | 'context'
> & {
  filename: string;
  mime: string;
  bytes: number;
};

function jsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The first document supplies a port with its URL-fragment nonce. Unlike its WindowProxy,
 * this endpoint does not follow the iframe to a later document, even before that document loads.
 */
export function createPanelBridge(options: {
  panel: ExtensionPanel;
  session: string;
  context: PanelContext;
  appearance: PanelAppearance;
  frame: () => Window | null;
  request: (body: PanelCall, signal: AbortSignal) => Promise<PanelResult>;
  binaryRequest?: (
    body: PanelCall,
    kind: 'image' | 'download',
    signal: AbortSignal,
  ) => Promise<PanelBinary>;
  uploadRequest?: (body: PanelUploadCall, blob: Blob, signal: AbortSignal) => Promise<PanelResult>;
  onDownloadChange?: (value: PanelDownload | null) => void;
  onMutation?: () => void;
  onReady?: () => void;
  onMessage?: (message: unknown) => void;
  onDispose?: () => void;
}) {
  const { panel, session, context } = options;
  let appearance = options.appearance;
  const pending = new Map<string, AbortController>();
  const seen = new Set<string>();
  const media = createPanelMedia(options.onDownloadChange);
  let disposed = false;
  let ready = false;
  let port: MessagePort | null = null;

  const envelope = { version: BRIDGE.panel.version, session };
  const postMessage = (message: unknown, transfer?: Transferable[]) => {
    if (disposed || !port) return;
    if (transfer) port.postMessage(message, transfer);
    else port.postMessage(message);
  };
  const reply = (message: PanelToFrame, transfer?: Transferable[]) =>
    postMessage(message, transfer);
  const error = (rid: string, status: number, detail: string) =>
    reply({
      ...envelope,
      type: BRIDGE.panel.types.response,
      rid,
      status,
      data: { detail },
      ok: false,
    });

  const handlePort = (event: MessageEvent) => {
    if (disposed) return;
    const message: unknown = event.data;
    if (!record(message) || message.session !== session) return;
    options.onMessage?.(message);
    if (message.version !== BRIDGE.panel.version || !ready) return;
    if (message.type === BRIDGE.panel.types.release) {
      if (typeof message.media_id === 'string') media.release(message.media_id);
      return;
    }
    const uploading = message.type === BRIDGE.panel.types.upload;
    if (message.type !== BRIDGE.panel.types.request && !uploading) return;
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
      if (uploading) {
        const { blob: _blob, ...metadata } = message;
        size = jsonSize(metadata);
      } else size = jsonSize(message);
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
    if ((declared.input === 'image') !== uploading) {
      error(rid, 403, 'Panel request input does not match its declared transport.');
      return;
    }
    let upload: { blob: Blob; filename: string } | null = null;
    if (uploading) {
      if (
        !(message.blob instanceof Blob) ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(message.blob.type) ||
        !message.blob.size ||
        message.blob.size > BRIDGE.panel.limits.imageBytes ||
        typeof message.filename !== 'string' ||
        !message.filename ||
        message.filename.length > 200 ||
        /[\x00-\x1f/\\]/.test(message.filename)
      ) {
        error(rid, 415, 'Panel upload requires a bounded image Blob and a plain filename.');
        return;
      }
      upload = { blob: message.blob, filename: message.filename };
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
    const responseKind = declared.response ?? 'json';
    const execute = async (): Promise<PanelResult | null> => {
      if (upload) {
        if (!options.uploadRequest) throw new Error('Panel upload transport is unavailable.');
        let dimensions: Awaited<ReturnType<typeof readImageDimensions>>;
        try {
          dimensions = await readImageDimensions(upload.blob, controller.signal);
        } catch {
          throw Object.assign(new Error('Panel upload image is invalid.'), { status: 415 });
        }
        if (!dimensions)
          throw Object.assign(new Error('Panel upload image header is invalid or unsupported.'), {
            status: 415,
          });
        if (dimensions.width * dimensions.height > BRIDGE.panel.limits.imagePixels)
          throw Object.assign(new Error('Panel upload exceeds the pixel limit.'), {
            status: 415,
          });
        controller.signal.throwIfAborted();
        return options.uploadRequest(
          {
            activation: panel.activation!,
            digest: panel.digest!,
            request_id: declared.id,
            context,
            filename: upload.filename,
            mime: upload.blob.type,
            bytes: upload.blob.size,
          },
          upload.blob,
          controller.signal,
        );
      }
      if (responseKind === 'json') return options.request(body, controller.signal);
      if (!options.binaryRequest) throw new Error('Panel media transport is unavailable.');
      const binary = await options.binaryRequest(body, responseKind, controller.signal);
      controller.signal.throwIfAborted();
      if (disposed) throw new Error('Panel session ended.');
      if (responseKind === 'image') {
        media.image(rid, binary, (port) =>
          reply(
            {
              ...envelope,
              type: BRIDGE.panel.types.media,
              rid,
              media_id: rid,
              mime: binary.blob.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
              bytes: binary.blob.size,
            },
            [port],
          ),
        );
        return null;
      }
      return { status: 200, data: media.stageDownload(binary) };
    };
    void execute()
      .then((result) => {
        if (!result || disposed || controller.signal.aborted) return;
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
      })
      .catch((cause: unknown) => {
        if (disposed || controller.signal.aborted) return;
        const failure = cause as { status?: number; message?: string };
        error(rid, failure.status ?? 500, failure.message ?? 'Panel request failed.');
      })
      .finally(() => pending.delete(rid));
  };

  const abort = () => {
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    media.clear();
  };
  return {
    handle: (event: MessageEvent) => {
      // A window message only offers a child-created port. Never send credentials or a port back
      // through the WindowProxy, and never replace the first document's endpoint.
      if (
        disposed ||
        event.origin !== 'null' ||
        !options.frame() ||
        event.source !== options.frame()
      )
        return;
      const message: unknown = event.data;
      if (
        !record(message) ||
        message.version !== BRIDGE.panel.version ||
        message.session !== session ||
        message.type !== BRIDGE.panel.types.ready ||
        event.ports.length !== 1
      )
        return;
      const offered = event.ports[0];
      if (port) {
        offered.close();
        return;
      }
      port = offered;
      ready = true;
      port.onmessage = handlePort;
      port.start();
      options.onReady?.();
      reply({
        ...envelope,
        type: BRIDGE.panel.types.init,
        context,
        appearance,
        requests: panel.requests ?? [],
        limits: {
          requestBytes: PANEL_REQUEST_LIMIT,
          responseBytes: PANEL_RESPONSE_LIMIT,
          concurrent: MAX_CONCURRENT,
          imageBytes: BRIDGE.panel.limits.imageBytes,
          downloadBytes: BRIDGE.panel.limits.downloadBytes,
          mediaBytes: BRIDGE.panel.limits.mediaBytes,
          mediaItems: BRIDGE.panel.limits.mediaItems,
        },
      });
    },
    postMessage,
    abort,
    updateAppearance: (next: PanelAppearance) => {
      if (JSON.stringify(appearance) === JSON.stringify(next)) return;
      appearance = next;
      if (!ready || disposed) return;
      reply({
        ...envelope,
        type: BRIDGE.panel.types.appearance,
        appearance,
      });
    },
    saveDownload: () => {
      if (!disposed) media.saveDownload();
    },
    clearDownload: media.clearDownload,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      port?.close();
      if (port) port.onmessage = null;
      port = null;
      abort();
      options.onDispose?.();
    },
  };
}
