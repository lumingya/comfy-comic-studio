import { BRIDGE } from '../api/extensionProtocol';

export interface PanelBinary {
  blob: Blob;
  filename: string;
}

export interface PanelDownload {
  filename: string;
  mime: string;
  bytes: number;
}

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const DOWNLOAD_MIMES = new Set([
  ...IMAGE_MIMES,
  'application/pdf',
  'application/zip',
  'application/octet-stream',
  'application/json',
  'text/html',
  'text/plain',
  'video/mp4',
  'video/webm',
]);
const MAX_FILENAME_CHARS = 190;

function panelFilename(response: Response): string {
  const encoded = response.headers.get('x-mio-panel-filename');
  // UTF-8 uses at most four bytes per character, with three ASCII characters per escape.
  if (
    !encoded ||
    encoded.length > MAX_FILENAME_CHARS * 12 ||
    !/^(?:[A-Za-z0-9._~-]|%[0-9a-f]{2})+$/i.test(encoded)
  )
    throw new Error('Panel download filename is invalid.');
  let filename: string;
  try {
    filename = decodeURIComponent(encoded);
  } catch {
    throw new Error('Panel download filename is invalid.');
  }
  if ([...filename].length > MAX_FILENAME_CHARS)
    throw new Error('Panel download filename is invalid.');
  return filename.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_');
}

/** Read the reviewed response as bytes, with an actual stream limit rather than trusting length. */
export async function readPanelBinary(
  response: Response,
  kind: 'image' | 'download',
  signal: AbortSignal,
): Promise<PanelBinary> {
  const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0].toLowerCase();
  if (
    !response.ok ||
    response.redirected ||
    response.headers.get('x-mio-panel-response') !== kind ||
    !(kind === 'image' ? IMAGE_MIMES : DOWNLOAD_MIMES).has(mime)
  ) {
    await response.body?.cancel();
    throw new Error('Response does not match the declared panel media type.');
  }
  const limit =
    kind === 'image' ? BRIDGE.panel.limits.imageBytes : BRIDGE.panel.limits.downloadBytes;
  const header = response.headers.get('content-length');
  if (header !== null && (!/^\d+$/.test(header) || Number(header) > limit)) {
    await response.body?.cancel();
    throw new Error('Panel media exceeds its byte limit.');
  }
  const expected = header === null ? null : Number(header);
  let filename: string;
  try {
    filename = panelFilename(response);
  } catch (error) {
    await response.body?.cancel();
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Panel media response has no body.');
  const abort = () => {
    void reader.cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error('Panel media exceeds its byte limit.');
      chunks.push(next.value.slice().buffer);
    }
    signal.throwIfAborted();
    if (expected !== null && expected !== bytes)
      throw new Error('Panel media response is incomplete.');
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  return { blob: new Blob(chunks, { type: mime }), filename };
}

/** Image ports belong to one iframe session. Downloads stay in the host until a real click. */
export function createPanelMedia(onDownloadChange?: (value: PanelDownload | null) => void) {
  const images = new Map<string, { port: MessagePort; bytes: number }>();
  const savedUrls = new Map<string, ReturnType<typeof setTimeout>>();
  let bytes = 0;
  let pending: PanelBinary | null = null;

  const release = (id: string) => {
    const image = images.get(id);
    if (!image) return;
    try {
      image.port.postMessage({ type: 'revoke' });
    } catch {
      // A navigated-away receiver may already have closed its end of the port.
    } finally {
      image.port.close();
    }
    bytes -= image.bytes;
    images.delete(id);
  };
  const clearDownload = () => {
    pending = null;
    onDownloadChange?.(null);
  };
  return {
    image(id: string, value: PanelBinary, deliver: (port: MessagePort) => void) {
      if (
        !IMAGE_MIMES.has(value.blob.type) ||
        images.has(id) ||
        value.blob.size > BRIDGE.panel.limits.imageBytes ||
        images.size >= BRIDGE.panel.limits.mediaItems ||
        bytes + value.blob.size > BRIDGE.panel.limits.mediaBytes
      )
        throw new Error('Panel image allowance reached; release previous images first.');
      const channel = new MessageChannel();
      images.set(id, { port: channel.port1, bytes: value.blob.size });
      bytes += value.blob.size;
      try {
        deliver(channel.port2);
        channel.port1.postMessage({ type: 'image', blob: value.blob });
      } catch (error) {
        release(id);
        channel.port2.close();
        throw error;
      }
      return { media_id: id, mime: value.blob.type, bytes: value.blob.size };
    },
    stageDownload(value: PanelBinary) {
      if (
        !DOWNLOAD_MIMES.has(value.blob.type) ||
        value.blob.size > BRIDGE.panel.limits.downloadBytes
      )
        throw new Error('Panel download exceeds its allowance.');
      pending = value;
      const metadata = { filename: value.filename, mime: value.blob.type, bytes: value.blob.size };
      onDownloadChange?.(metadata);
      return { download_ready: true, ...metadata };
    },
    saveDownload() {
      if (!pending) return;
      const value = pending;
      clearDownload();
      const url = URL.createObjectURL(value.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = value.filename;
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        savedUrls.set(
          url,
          setTimeout(() => {
            URL.revokeObjectURL(url);
            savedUrls.delete(url);
          }, 5000),
        );
      }
    },
    clearDownload,
    release,
    clear() {
      for (const id of images.keys()) release(id);
      clearDownload();
      for (const [url, timer] of savedUrls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      savedUrls.clear();
    },
  };
}
