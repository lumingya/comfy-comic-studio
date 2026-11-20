import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE } from '../api/extensionProtocol';
import { createPanelMedia, readPanelBinary } from './extensionMedia';

const response = (bytes = new Uint8Array([1, 2, 3]), headers: Record<string, string> = {}) =>
  new Response(bytes, {
    headers: { 'content-type': 'image/png', 'x-mio-panel-response': 'image', ...headers },
  });

describe('bounded panel binary transport', () => {
  it('reads bytes outside JSON and validates the declared MIME and content length', async () => {
    const signal = new AbortController().signal;
    const result = await readPanelBinary(response(), 'image', signal);
    expect(result.blob.size).toBe(3);
    expect(result.blob.type).toBe('image/png');
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
      { headers: { 'content-type': 'image/png', 'x-mio-panel-response': 'image' } },
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
