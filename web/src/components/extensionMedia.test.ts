import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE } from '../api/extensionProtocol';
import { createPanelMedia, readPanelBinary } from './extensionMedia';

const response = (bytes = new Uint8Array([1, 2, 3]), headers: Record<string, string> = {}) =>
  new Response(bytes, {
    headers: {
      'content-type': 'image/png',
      'x-mio-panel-response': 'image',
      'x-mio-panel-filename': 'image.png',
      ...headers,
    },
  });

describe('bounded panel binary transport', () => {
  it('reads bytes outside JSON and validates the declared MIME and content length', async () => {
    const signal = new AbortController().signal;
    const result = await readPanelBinary(response(), 'image', signal);
    expect(result.blob.size).toBe(3);
    expect(result.blob.type).toBe('image/png');
    expect(result.filename).toBe('image.png');
    const invalidHeaders: Record<string, string>[] = [
      { 'content-type': 'image/svg+xml' },
      { 'x-mio-panel-response': 'download' },
      { 'content-length': '1' },
      { 'content-length': '-1' },
      { 'content-length': String(BRIDGE.panel.limits.imageBytes + 1) },
    ];
    for (const headers of invalidHeaders)
      await expect(
        readPanelBinary(response(undefined, headers), 'image', signal),
      ).rejects.toThrow();
  });

  it('reads the dedicated UTF-8 filename header without requiring a download disposition', async () => {
    const signal = new AbortController().signal;
    const file = new Response('%PDF-1.7\n%%EOF', {
      headers: {
        'content-type': 'application/pdf',
        'x-mio-panel-response': 'download',
        'x-mio-panel-filename': '%E9%9B%A8%201%20%28A%29%21%25.pdf',
      },
    });
    expect(file.headers.has('content-disposition')).toBe(false);
    const result = await readPanelBinary(file, 'download', signal);
    expect(result.filename).toBe('雨 1 (A)!%.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(result.blob.size).toBe(14);
  });

  it('normalizes decoded filename paths and controls and uses the dedicated header as authoritative', async () => {
    const result = await readPanelBinary(
      response(undefined, {
        'x-mio-panel-filename': '..%2Fdir%5Cbad%00%0A%7F%3C%3E%3A%22%7C%3F%2A.png',
        'content-disposition': "attachment; filename*=UTF-8''different.png",
      }),
      'image',
      new AbortController().signal,
    );
    expect(result.filename).toBe('.._dir_bad__________.png');
  });

  it('rejects missing, malformed, non-UTF-8 and oversized filename headers before reading bytes', async () => {
    const invalid = [
      null,
      '',
      'bad%.png',
      'bad%2.png',
      'bad%GG.png',
      '%C3%28.png',
      'raw space.png',
      'raw/path.png',
      'raw+name.png',
      `${'a'.repeat(191)}.png`,
      '%41'.repeat(190 * 4 + 1),
    ];
    for (const filename of invalid) {
      const cancel = vi.fn();
      const headers = new Headers({
        'content-type': 'image/png',
        'x-mio-panel-response': 'image',
        'content-disposition': "attachment; filename*=UTF-8''fallback.png",
      });
      if (filename !== null) headers.set('x-mio-panel-filename', filename);
      const file = new Response(new ReadableStream({ cancel }), { headers });
      await expect(readPanelBinary(file, 'image', new AbortController().signal)).rejects.toThrow(
        'filename is invalid',
      );
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it('accepts bounded supplementary Unicode without cutting off the filename suffix', async () => {
    const filename = `${'🌧'.repeat(180)}.png`;
    const result = await readPanelBinary(
      response(undefined, { 'x-mio-panel-filename': encodeURIComponent(filename) }),
      'image',
      new AbortController().signal,
    );
    expect(result.filename).toBe(filename);
  });

  it('counts chunked bytes even without a length header and rejects aborts', async () => {
    const signal = new AbortController().signal;
    const overflow = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(BRIDGE.panel.limits.imageBytes));
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      {
        headers: {
          'content-type': 'image/png',
          'x-mio-panel-response': 'image',
          'x-mio-panel-filename': 'image.png',
        },
      },
    );
    await expect(readPanelBinary(overflow, 'image', signal)).rejects.toThrow('byte limit');
    const aborted = new AbortController();
    aborted.abort();
    await expect(readPanelBinary(response(), 'image', aborted.signal)).rejects.toThrow();
  });
});

describe('session-owned panel media', () => {
  const createURL = vi.fn(() => `blob:host/${Math.random()}`);
  const revokeURL = vi.fn();
  const channels: {
    port1: { postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    port2: object;
  }[] = [];
  beforeEach(() => {
    class MediaURL extends URL {
      static createObjectURL = createURL;
      static revokeObjectURL = revokeURL;
    }
    vi.stubGlobal('URL', MediaURL);
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = { postMessage: vi.fn(), close: vi.fn() };
        port2 = { close: vi.fn() };
        constructor() {
          channels.push(this);
        }
      },
    );
    channels.length = 0;
    createURL.mockClear();
    revokeURL.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('transfers image ports, bounds retained images and revokes sessions without host blob URLs', () => {
    const media = createPanelMedia();
    const binary = { blob: new Blob(['png'], { type: 'image/png' }), filename: 'image.png' };
    const deliver = vi.fn();
    const first = media.image('first', binary, deliver);
    expect(first).toEqual({
      media_id: 'first',
      bytes: 3,
      mime: 'image/png',
    });
    for (let i = 1; i < BRIDGE.panel.limits.mediaItems; i++)
      media.image(String(i), binary, deliver);
    expect(() => media.image('overflow', binary, deliver)).toThrow('allowance');
    expect(createURL).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(channels[0].port2);
    expect(channels[0].port1.postMessage).toHaveBeenCalledWith({
      type: 'image',
      blob: binary.blob,
    });
    media.release('first');
    expect(channels[0].port1.postMessage).toHaveBeenLastCalledWith({ type: 'revoke' });
    expect(channels[0].port1.close).toHaveBeenCalledOnce();
    media.image('replacement', binary, deliver);
    media.clear();
    expect(channels).toHaveLength(BRIDGE.panel.limits.mediaItems + 1);
    for (const channel of channels) expect(channel.port1.close).toHaveBeenCalledOnce();
    expect(revokeURL).not.toHaveBeenCalled();
  });

  it('stages downloads without clicking or rendering HTML, and saves only from the host action', () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const media = createPanelMedia(changed);
    const result = media.stageDownload({
      blob: new Blob(['<script>window.executed=true</script>'], { type: 'text/html' }),
      filename: 'motion.html',
    });
    expect(result).toMatchObject({
      download_ready: true,
      filename: 'motion.html',
      mime: 'text/html',
    });
    expect(click).not.toHaveBeenCalled();
    expect(createURL).not.toHaveBeenCalled();
    media.saveDownload();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(null);
    media.saveDownload();
    expect(click).toHaveBeenCalledOnce();
    media.clear();
    expect(revokeURL).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops pending downloads as soon as a session ends', () => {
    const changed = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const media = createPanelMedia(changed);
    media.stageDownload({
      blob: new Blob(['file'], { type: 'application/pdf' }),
      filename: 'a.pdf',
    });
    media.clear();
    media.saveDownload();
    expect(click).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(null);
  });
});
