import { describe, expect, it, vi } from 'vitest';
import type { ExtensionPanel } from '../api/open';
import {
  createPanelBridge,
  PANEL_REQUEST_LIMIT,
  PANEL_RESPONSE_LIMIT,
  type PanelCall,
  type PanelResult,
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
  const frame = { postMessage } as unknown as Window;
  const mutation = vi.fn();
  const binaryRequest = vi.fn(
    async (_body: PanelCall, _kind: 'image' | 'download', _signal: AbortSignal) => ({
      blob: new Blob(['image'], { type: 'image/png' }),
      filename: 'image.png',
    }),
  );
  const download = vi.fn();
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
  });
  const send = (data: Record<string, unknown>, source: MessageEventSource = frame) =>
    bridge.handle(
      new MessageEvent('message', {
        source,
        origin: 'null',
        data: { version: 1, session: 'nonce', ...data },
      }),
    );
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
    postMessage,
    request,
    binaryRequest,
    download,
    mutation,
    send,
    ready,
    call,
  };
}

describe('sandbox panel bridge', () => {
  it('requires the actual frame, nonce, version and handshake without automatically calling APIs', () => {
    const s = setup();
    s.call();
    s.send({ type: 'mio:panel:ready' }, window);
    s.send({ type: 'mio:panel:ready', session: 'stale' });
    s.send({ type: 'mio:panel:ready', version: 2 });
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.bridge.handle(
      new MessageEvent('message', {
        source: s.frame,
        origin: 'https://attacker.invalid',
        data: { version: 1, session: 'nonce', type: 'mio:panel:ready' },
      }),
    );
    expect(s.frame.postMessage).not.toHaveBeenCalled();
    s.ready();
    expect(s.frame.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mio:panel:init',
        context: { episode_id: 'ep' },
        appearance: {
          tokens: { bg: '#17191b', accent: '#e0a070' },
          theme: 'dark',
          locale: 'zh-CN',
        },
      }),
      '*',
    );
    expect(s.request).not.toHaveBeenCalled();
  });

  it('updates appearance after initialization without changing API context', () => {
    const s = setup();
    s.ready();
    s.postMessage.mockClear();
    s.bridge.updateAppearance({ tokens: { bg: '#fff' }, theme: 'light', locale: 'en' });
    expect(s.frame.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mio:panel:appearance',
        session: 'nonce',
        appearance: { tokens: { bg: '#fff' }, theme: 'light', locale: 'en' },
      }),
      '*',
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
    expect(s.frame.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mio:panel:appearance' }),
      '*',
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
      expect(s.frame.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mio:panel:response',
          rid: 'first',
          status: 200,
          ok: true,
        }),
        '*',
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
    expect(s.frame.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 403 }),
      '*',
    );
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
    expect(s.frame.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 413 }),
      '*',
    );
    for (let i = 0; i < 5; i++) s.call(`r${i}`);
    expect(pending).toHaveBeenCalledTimes(4);
    expect(s.frame.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 429 }),
      '*',
    );
    resolve({ status: 200, data: 'a'.repeat(PANEL_RESPONSE_LIMIT) });
    await vi.waitFor(() =>
      expect(s.frame.postMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 413 }),
        '*',
      ),
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
    const count = vi.mocked(s.frame.postMessage).mock.calls.length;
    s.bridge.dispose();
    expect(request.mock.calls[0][1].aborted).toBe(true);
    resolve({ status: 200, data: null });
    await Promise.resolve();
    expect(s.frame.postMessage).toHaveBeenCalledTimes(count);
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
        expect(s.frame.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'mio:panel:media',
            rid: 'picture',
            media_id: 'picture',
            bytes: 5,
          }),
          '*',
          [port2],
        ),
      );
      expect(port1.postMessage).toHaveBeenCalledWith({ type: 'image', blob: expect.any(Blob) });
      expect(s.frame.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mio:panel:response', rid: 'picture' }),
        '*',
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
});
