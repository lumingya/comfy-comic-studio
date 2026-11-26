import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionPanel } from '../api/open';
import { BRIDGE } from '../api/extensionProtocol';
import * as imageHeader from './imageHeader';
import {
  createPanelBridge,
  PANEL_REQUEST_LIMIT,
  PANEL_REQUEST_TIMEOUT_MS,
  PANEL_RESPONSE_LIMIT,
  type PanelCall,
  type PanelResult,
  type PanelUploadCall,
} from './extensionBridge';

const panel: ExtensionPanel = {
  extension: 'demo',
  id: 'review',
  title: 'Review',
  slot: 'episode',
  url: '/api/extensions/demo/files/panel.html',
  activation: 'loaded-once',
  digest: 'a'.repeat(64),
  requests: [
    { id: 'episode', method: 'GET', path: '/episodes/{episode_id}', scope: 'read' },
    { id: 'run', method: 'POST', path: '/ext/demo/run', scope: 'render' },
    { id: 'image', method: 'GET', path: '/ext/demo/image', scope: 'read', response: 'image' },
    { id: 'file', method: 'POST', path: '/ext/demo/file', scope: 'write', response: 'download' },
    { id: 'mask', method: 'POST', path: '/assets', scope: 'write', input: 'image' },
  ],
};

function setup(
  handler: (body: PanelCall, signal: AbortSignal) => Promise<PanelResult> = async () => ({
    status: 200,
    data: { id: 'ep' },
  }),
) {
  const request = vi.fn(handler);
  const postMessage = vi.fn();
  const frame = { postMessage: vi.fn() } as unknown as Window;
  const port = {
    postMessage,
    start: vi.fn(),
    close: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };
  const mutation = vi.fn();
  const binaryRequest = vi.fn(
    async (_body: PanelCall, _kind: 'image' | 'download', _signal: AbortSignal) => ({
      blob: new Blob(['image'], { type: 'image/png' }),
      filename: 'image.png',
    }),
  );
  const download = vi.fn();
  const uploadRequest = vi.fn(
    async (_body: PanelUploadCall, _blob: Blob, _signal: AbortSignal) => ({
      status: 201,
      data: { id: 'asset' },
    }),
  );
  const bridge = createPanelBridge({
    panel,
    session: 'nonce',
    context: { episode_id: 'ep' },
    appearance: { tokens: { bg: '#17191b', accent: '#e0a070' }, theme: 'dark', locale: 'zh-CN' },
    frame: () => frame,
    request,
    onMutation: mutation,
    binaryRequest,
    onDownloadChange: download,
    uploadRequest,
  });
  const windowSend = (data: Record<string, unknown>, source: MessageEventSource = frame) =>
    bridge.handle(
      new MessageEvent('message', {
        source,
        origin: 'null',
        data: { version: BRIDGE.panel.version, session: 'nonce', ...data },
        ports: [port as unknown as MessagePort],
      }),
    );
  const send = (data: Record<string, unknown>, source: MessageEventSource = frame) => {
    if (data.type === 'mio:panel:ready') windowSend(data, source);
    else
      port.onmessage?.(
        new MessageEvent('message', {
          data: { version: BRIDGE.panel.version, session: 'nonce', ...data },
        }),
      );
  };
  const ready = () => send({ type: 'mio:panel:ready' });
  const call = (rid = 'one', extra: Record<string, unknown> = {}) =>
    send({
      type: 'mio:panel:request',
      rid,
      request_id: 'episode',
      path_params: { episode_id: 'ep' },
      ...extra,
    });
  return {
    bridge,
    frame,
    port,
    postMessage,
    request,
    binaryRequest,
    download,
    mutation,
    uploadRequest,
    send,
    windowSend,
    ready,
    call,
  };
}

function png(width = 4096, height = 4096, bytes = 33): Blob {
  const header = new Uint8Array(bytes);
  header.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const data = new DataView(header.buffer);
  data.setUint32(16, width);
  data.setUint32(20, height);
  header[24] = 8;
  header[25] = 6;
  return new Blob([header], { type: 'image/png' });
}

describe('sandbox panel bridge', () => {
  describe('request deadlines', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('aborts all occupied transports at the deadline and immediately accepts a new request', async () => {
      vi.useFakeTimers();
      const s = setup(() => new Promise(() => {}));
      try {
        s.ready();
        for (let i = 0; i < 4; i++) s.call(`pending-${i}`);
        s.call('limited');
        expect(s.request).toHaveBeenCalledTimes(4);
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ rid: 'limited', status: 429 }),
        );
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS - 1);
        expect(s.request.mock.calls.every(([, signal]) => !signal.aborted)).toBe(true);
        s.call('still-limited');
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ rid: 'still-limited', status: 429 }),
        );

        await vi.advanceTimersByTimeAsync(1);
        expect(s.request.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
        for (let i = 0; i < 4; i++)
          expect(s.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ rid: `pending-${i}`, status: 504, ok: false }),
          );
        expect(vi.getTimerCount()).toBe(0);
        s.request.mockResolvedValueOnce({ status: 200, data: { recovered: true } });
        s.call('recovered');
        await vi.advanceTimersByTimeAsync(0);
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ rid: 'recovered', status: 200, ok: true }),
        );
        expect(s.request).toHaveBeenCalledTimes(5);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.bridge.dispose();
      }
    });

    it('recovers after two timed-out read rounds and ignores their late results', async () => {
      vi.useFakeTimers();
      const resolve: ((result: PanelResult) => void)[] = [];
      const s = setup(() => new Promise((done) => resolve.push(done)));
      try {
        s.ready();
        for (let round = 0; round < 2; round++) {
          s.call(`episode-${round}`);
          s.call(`profiles-${round}`);
          expect(s.request).toHaveBeenCalledTimes((round + 1) * 2);
          await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        }
        s.request.mockResolvedValueOnce({ status: 200, data: { id: 'ep' } });
        s.call('restored');
        await vi.advanceTimersByTimeAsync(0);
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ rid: 'restored', status: 200 }),
        );
        s.call('episode-0');
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ rid: 'episode-0', status: 409 }),
        );
        const replies = s.postMessage.mock.calls.length;
        for (const done of resolve) done({ status: 200, data: { stale: true } });
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(s.postMessage).toHaveBeenCalledTimes(replies);
        expect(s.request).toHaveBeenCalledTimes(5);
        expect(s.mutation).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.bridge.dispose();
      }
    });

    it('clears deadlines after success, returned failures and thrown failures', async () => {
      vi.useFakeTimers();
      const s = setup();
      try {
        s.ready();
        s.request.mockResolvedValueOnce({ status: 200, data: null });
        s.request.mockResolvedValueOnce({ status: 403, data: { detail: 'Denied' } });
        s.request.mockRejectedValueOnce(new Error('Offline'));
        s.call('success');
        s.call('denied');
        s.call('offline');
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(s.request.mock.calls.every(([, signal]) => !signal.aborted)).toBe(true);
        for (const [rid, status] of [
          ['success', 200],
          ['denied', 403],
          ['offline', 500],
        ])
          expect(s.postMessage).toHaveBeenCalledWith(expect.objectContaining({ rid, status }));
        const replies = s.postMessage.mock.calls.length;
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(s.postMessage).toHaveBeenCalledTimes(replies);
      } finally {
        s.bridge.dispose();
      }
    });

    it('clears deadlines on navigation abort and disposal without timeout replies', async () => {
      vi.useFakeTimers();
      const s = setup(() => new Promise(() => {}));
      try {
        s.ready();
        s.call('navigated');
        s.bridge.abort();
        expect(s.request.mock.calls[0][1].aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        s.call('disposed');
        const replies = s.postMessage.mock.calls.length;
        s.bridge.dispose();
        expect(s.request.mock.calls[1][1].aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(s.postMessage).toHaveBeenCalledTimes(replies);
        expect(s.port.close).toHaveBeenCalledOnce();
      } finally {
        s.bridge.dispose();
      }
    });

    it('aborts an overdue write once, warns to check its result and never retries it', async () => {
      vi.useFakeTimers();
      let resolve!: (result: PanelResult) => void;
      const s = setup(() => new Promise((done) => (resolve = done)));
      try {
        s.ready();
        s.call('write', { request_id: 'run', body: { value: 1 } });
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(s.request.mock.calls[0][1].aborted).toBe(true);
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            rid: 'write',
            status: 504,
            data: {
              detail:
                'Panel request timed out. The operation may have completed; check its result before retrying.',
            },
          }),
        );
        const replies = s.postMessage.mock.calls.length;
        resolve({ status: 201, data: { job_id: 'already-created' } });
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS * 2);
        expect(s.request).toHaveBeenCalledOnce();
        expect(s.postMessage).toHaveBeenCalledTimes(replies);
        expect(s.mutation).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.bridge.dispose();
      }
    });

    it('bounds binary and upload transports without creating late media or retrying writes', async () => {
      vi.useFakeTimers();
      vi.spyOn(imageHeader, 'readImageDimensions').mockResolvedValue({ width: 2, height: 2 });
      const s = setup();
      let resolveBinary!: (binary: { blob: Blob; filename: string }) => void;
      let resolveUpload!: (result: { status: number; data: { id: string } }) => void;
      s.binaryRequest.mockImplementation(() => new Promise((done) => (resolveBinary = done)));
      s.uploadRequest.mockImplementation(() => new Promise((done) => (resolveUpload = done)));
      try {
        s.ready();
        s.call('binary', { request_id: 'file' });
        s.send({
          type: 'mio:panel:upload',
          rid: 'upload',
          request_id: 'mask',
          filename: 'mask.png',
          blob: png(2, 2),
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(s.uploadRequest).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(s.binaryRequest.mock.calls[0][2].aborted).toBe(true);
        expect(s.uploadRequest.mock.calls[0][2].aborted).toBe(true);
        for (const rid of ['binary', 'upload'])
          expect(s.postMessage).toHaveBeenCalledWith(expect.objectContaining({ rid, status: 504 }));
        const replies = s.postMessage.mock.calls.length;
        resolveBinary({ blob: png(2, 2), filename: 'late.png' });
        resolveUpload({ status: 201, data: { id: 'late-asset' } });
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(s.binaryRequest).toHaveBeenCalledOnce();
        expect(s.uploadRequest).toHaveBeenCalledOnce();
        expect(s.download).not.toHaveBeenCalled();
        expect(s.mutation).not.toHaveBeenCalled();
        expect(s.postMessage).toHaveBeenCalledTimes(replies);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.bridge.dispose();
      }
    });

    it('includes image header reads in the upload deadline', async () => {
      vi.useFakeTimers();
      const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => {});
      const abort = vi.spyOn(FileReader.prototype, 'abort');
      const s = setup();
      try {
        s.ready();
        s.send({
          type: 'mio:panel:upload',
          rid: 'header',
          request_id: 'mask',
          filename: 'mask.png',
          blob: png(2, 2),
        });
        expect(read).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(PANEL_REQUEST_TIMEOUT_MS);
        expect(abort).toHaveBeenCalledOnce();
        expect(s.uploadRequest).not.toHaveBeenCalled();
        expect(s.postMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({ rid: 'header', status: 504 }),
        );
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.bridge.dispose();
      }
    });
  });

  it('requires the actual frame, nonce, version and handshake without automatically calling APIs', () => {
    const s = setup();
    s.call();
    s.send({ type: 'mio:panel:ready' }, window);
    s.send({ type: 'mio:panel:ready', session: 'stale' });
    s.send({ type: 'mio:panel:ready', version: 1 });
    expect(s.postMessage).not.toHaveBeenCalled();
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.bridge.handle(
      new MessageEvent('message', {
        source: s.frame,
        origin: 'https://attacker.invalid',
        data: { version: BRIDGE.panel.version, session: 'nonce', type: 'mio:panel:ready' },
      }),
    );
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.ready();
    expect(s.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mio:panel:init',
        context: { episode_id: 'ep' },
        appearance: {
          tokens: { bg: '#17191b', accent: '#e0a070' },
          theme: 'dark',
          locale: 'zh-CN',
        },
      }),
    );
    expect(s.request).not.toHaveBeenCalled();
  });

  it('updates appearance after initialization without changing API context', () => {
    const s = setup();
    s.ready();
    s.postMessage.mockClear();
    s.bridge.updateAppearance({ tokens: { bg: '#fff' }, theme: 'light', locale: 'en' });
    expect(s.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mio:panel:appearance',
        session: 'nonce',
        appearance: { tokens: { bg: '#fff' }, theme: 'light', locale: 'en' },
      }),
    );
    expect(s.request).not.toHaveBeenCalled();
    s.bridge.dispose();
  });

  it('does not send appearance until the actual frame passes the session handshake', () => {
    const s = setup();
    s.bridge.updateAppearance({ tokens: {}, theme: null, locale: 'en' });
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.send({ type: 'mio:panel:ready' }, window);
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.ready();
    s.postMessage.mockClear();
    s.bridge.updateAppearance({ tokens: {}, theme: 'light', locale: 'en' });
    expect(s.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mio:panel:appearance' }),
    );
    s.bridge.dispose();
  });

  it('passes only declared request fields and returns the correlated result', async () => {
    const s = setup();
    s.ready();
    s.call('first', {
      context: { episode_id: 'other' },
      headers: { Authorization: 'injected' },
      url: 'https://example.invalid',
    });
    await vi.waitFor(() =>
      expect(s.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mio:panel:response',
          rid: 'first',
          status: 200,
          ok: true,
        }),
      ),
    );
    expect(s.request.mock.calls[0][0]).toEqual({
      activation: panel.activation,
      digest: panel.digest,
      request_id: 'episode',
      context: { episode_id: 'ep' },
      path_params: { episode_id: 'ep' },
      query: undefined,
      body: undefined,
    });
    s.call('first');
    s.call('unknown', { request_id: 'anything' });
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 403 }));
  });

  it('bounds JSON payloads, responses and concurrency', async () => {
    let resolve: (result: PanelResult) => void = () => {};
    const pending = vi.fn(
      () =>
        new Promise<PanelResult>((done) => {
          resolve = done;
        }),
    );
    const s = setup(pending as never);
    s.ready();
    s.call('large', { body: 'a'.repeat(PANEL_REQUEST_LIMIT) });
    expect(s.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 413 }));
    for (let i = 0; i < 5; i++) s.call(`r${i}`);
    expect(pending).toHaveBeenCalledTimes(4);
    expect(s.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 429 }));
    resolve({ status: 200, data: 'a'.repeat(PANEL_RESPONSE_LIMIT) });
    await vi.waitFor(() =>
      expect(s.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 413 })),
    );
    s.bridge.dispose();
  });

  it('aborts old requests and discards late responses on disposal', async () => {
    let resolve: (result: PanelResult) => void = () => {};
    const request = vi.fn(
      (_body, _signal: AbortSignal) =>
        new Promise<PanelResult>((done) => {
          resolve = done;
        }),
    );
    const s = setup(request as never);
    s.ready();
    s.call();
    const count = s.postMessage.mock.calls.length;
    s.bridge.dispose();
    expect(request.mock.calls[0][1].aborted).toBe(true);
    resolve({ status: 200, data: null });
    await Promise.resolve();
    expect(s.postMessage).toHaveBeenCalledTimes(count);
    expect(s.port.close).toHaveBeenCalledOnce();
    s.call('late');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('refreshes host data only after successful explicit mutations', async () => {
    const s = setup();
    s.ready();
    s.call('run', { request_id: 'run', body: { value: 1 } });
    await vi.waitFor(() => expect(s.mutation).toHaveBeenCalledOnce());
    expect(s.request).toHaveBeenCalledOnce();
  });

  it('chooses binary mode only from the reviewed declaration and clears pending downloads', async () => {
    const s = setup();
    s.ready();
    s.call('download', { request_id: 'file', body: {} });
    await vi.waitFor(() =>
      expect(s.download).toHaveBeenCalledWith(expect.objectContaining({ filename: 'image.png' })),
    );
    expect(s.binaryRequest).toHaveBeenCalledOnce();
    expect(s.binaryRequest.mock.calls[0][1]).toBe('download');
    expect(s.request).not.toHaveBeenCalled();
    s.call('read-json', { response: 'download' });
    await vi.waitFor(() => expect(s.request).toHaveBeenCalledOnce());
    expect(s.binaryRequest).toHaveBeenCalledOnce();
    s.bridge.abort();
    expect(s.download).toHaveBeenLastCalledWith(null);
    s.bridge.dispose();
  });

  it('transfers image bytes only over the session port and closes it on explicit release', async () => {
    const port1 = { postMessage: vi.fn(), close: vi.fn() };
    const port2 = { close: vi.fn() };
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = port1;
        port2 = port2;
      },
    );
    const s = setup();
    try {
      s.ready();
      s.call('picture', { request_id: 'image' });
      await vi.waitFor(() =>
        expect(s.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'mio:panel:media',
            rid: 'picture',
            media_id: 'picture',
            bytes: 5,
          }),
          [port2],
        ),
      );
      expect(port1.postMessage).toHaveBeenCalledWith({ type: 'image', blob: expect.any(Blob) });
      expect(s.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mio:panel:response', rid: 'picture' }),
      );
      s.send({ type: 'mio:panel:release', media_id: 'picture', session: 'stale' });
      expect(port1.close).not.toHaveBeenCalled();
      s.send({ type: 'mio:panel:release', media_id: 'picture' });
      expect(port1.postMessage).toHaveBeenLastCalledWith({ type: 'revoke' });
      expect(port1.close).toHaveBeenCalledOnce();
    } finally {
      s.bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('requires a child-created port and never falls back to window business messages', () => {
    const s = setup();
    s.bridge.handle(
      new MessageEvent('message', {
        source: s.frame,
        origin: 'null',
        data: { type: 'mio:panel:ready', version: BRIDGE.panel.version, session: 'nonce' },
      }),
    );
    expect(s.port.start).not.toHaveBeenCalled();
    s.ready();
    s.windowSend({ type: 'mio:panel:request', rid: 'attack', request_id: 'episode' });
    expect(s.request).not.toHaveBeenCalled();
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.bridge.dispose();
  });

  it('uploads native binary beyond 64 KiB with separate bounded metadata and host identity', async () => {
    const decode = vi.fn(() => {
      throw new Error('Host must not decode untrusted images.');
    });
    vi.stubGlobal('createImageBitmap', decode);
    const s = setup();
    const blob = png(4096, 4096, 70 * 1024);
    const message = {
      type: 'mio:panel:upload',
      rid: 'upload',
      request_id: 'mask',
      filename: 'mask.png',
      blob,
    };
    try {
      s.send(message);
      expect(s.uploadRequest).not.toHaveBeenCalled();
      s.ready();
      s.windowSend(message);
      expect(s.uploadRequest).not.toHaveBeenCalled();
      s.send({ ...message, context: { episode_id: 'injected' }, activation: 'injected' });
      await vi.waitFor(() => expect(s.uploadRequest).toHaveBeenCalledOnce());
      expect(s.uploadRequest).toHaveBeenCalledWith(
        {
          activation: panel.activation,
          digest: panel.digest,
          request_id: 'mask',
          context: { episode_id: 'ep' },
          filename: 'mask.png',
          mime: 'image/png',
          bytes: blob.size,
        },
        blob,
        expect.any(AbortSignal),
      );
      expect(decode).not.toHaveBeenCalled();
      expect(s.request).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(s.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ rid: 'upload', status: 201 }),
        ),
      );
      s.send({ ...message, rid: 'metadata', body: 'x'.repeat(PANEL_REQUEST_LIMIT) });
      expect(s.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ rid: 'metadata', status: 413 }),
      );
      s.call('json-mask', { request_id: 'mask' });
      expect(s.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 403 }));
      expect(s.frame.postMessage).not.toHaveBeenCalled();
    } finally {
      s.bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('rejects undeclared, spoofed, unknown and over-pixel uploads before any decoding', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const s = setup();
    const message = {
      type: 'mio:panel:upload',
      rid: 'pixels',
      request_id: 'mask',
      filename: 'mask.png',
      blob: png(4097, 4096),
    };
    try {
      s.ready();
      s.send({ ...message, request_id: 'episode', rid: 'undeclared' });
      s.send({ ...message, blob: { type: 'image/png', size: 1 }, rid: 'spoofed' });
      s.send({ ...message, blob: new Blob(['x'], { type: 'image/png' }), rid: 'invalid' });
      s.send({ ...message, blob: png(0, 100), rid: 'zero' });
      s.send({ ...message, blob: new Blob([png()], { type: 'image/jpeg' }), rid: 'mismatch' });
      s.send({
        ...message,
        blob: new Blob(['<svg width="1" height="1"/>'], { type: 'image/svg+xml' }),
        rid: 'unknown',
      });
      // Await each bounded read before testing another upload (the bridge permits four at once).
      await vi.waitFor(() =>
        expect(s.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ rid: 'invalid', status: 415 }),
        ),
      );
      s.send(message);
      await vi.waitFor(() =>
        expect(s.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ rid: 'pixels', status: 415 }),
        ),
      );
      for (const rid of ['spoofed', 'invalid', 'zero', 'mismatch', 'unknown'])
        expect(s.postMessage).toHaveBeenCalledWith(expect.objectContaining({ rid, status: 415 }));
      expect(s.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ rid: 'undeclared', status: 403 }),
      );
      expect(decode).not.toHaveBeenCalled();
      expect(s.uploadRequest).not.toHaveBeenCalled();
      s.send({ ...message, blob: png(2, 2), rid: 'closing' });
      s.bridge.dispose();
      await Promise.resolve();
      expect(s.uploadRequest).not.toHaveBeenCalled();
    } finally {
      s.bridge.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('rejects image bytes beyond 32 MiB before reading a header', () => {
    const s = setup();
    const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');
    try {
      s.ready();
      s.send({
        type: 'mio:panel:upload',
        rid: 'large-image',
        request_id: 'mask',
        filename: 'mask.png',
        blob: png(1, 1, BRIDGE.panel.limits.imageBytes + 1),
      });
      expect(s.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ rid: 'large-image', status: 415 }),
      );
      expect(read).not.toHaveBeenCalled();
      expect(s.uploadRequest).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      s.bridge.dispose();
    }
  });

  it('refuses rebinding before a navigation load and sends late results only to the original port', async () => {
    let resolve!: (result: PanelResult) => void;
    const s = setup(() => new Promise((done) => (resolve = done)));
    s.ready();
    s.call();
    const nextPort = { close: vi.fn(), postMessage: vi.fn(), start: vi.fn() };
    s.bridge.handle(
      new MessageEvent('message', {
        source: s.frame,
        origin: 'null',
        data: { type: 'mio:panel:ready', version: BRIDGE.panel.version, session: 'nonce' },
        ports: [nextPort as unknown as MessagePort],
      }),
    );
    s.windowSend({ type: 'mio:panel:request', rid: 'navigation', request_id: 'run' });
    resolve({ status: 200, data: { private: true } });
    await vi.waitFor(() =>
      expect(s.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mio:panel:response', data: { private: true } }),
      ),
    );
    expect(s.request).toHaveBeenCalledOnce();
    expect(nextPort.close).toHaveBeenCalledOnce();
    expect(nextPort.start).not.toHaveBeenCalled();
    expect(nextPort.postMessage).not.toHaveBeenCalled();
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.bridge.dispose();
  });
});
