import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionPanel } from '../api/open';
import { BRIDGE } from '../api/extensionProtocol';
import { renderWithProviders } from '../test/utils';
import { ExtensionFrame } from './ExtensionFrame';

const panel: ExtensionPanel = {
  extension: 'demo',
  id: 'appearance',
  title: 'Appearance probe',
  slot: 'episode',
  url: '/api/extensions/demo/files/panel.html',
  requests: [],
};

function documentPort() {
  return { postMessage: vi.fn(), close: vi.fn(), start: vi.fn(), onmessage: null };
}

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.lang = 'zh-CN';
  vi.restoreAllMocks();
});

describe('sandbox panel appearance context', () => {
  it('delegates only fullscreen while preserving the opaque-origin sandbox', () => {
    const view = renderWithProviders(<ExtensionFrame panel={panel} />);
    const iframe = view.getByTitle('Appearance probe') as HTMLIFrameElement;

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('allow')).toBe('fullscreen');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('sends current tokens on init and live appearance updates without changing API context', async () => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    root.lang = 'zh-CN';
    root.style.setProperty('--bg', '#17191b');
    root.style.setProperty('--accent', '#e0a070');

    const view = renderWithProviders(<ExtensionFrame panel={panel} params={{ episode: 'ep-1' }} />);
    const iframe = view.getByTitle('Appearance probe') as HTMLIFrameElement;
    const child = iframe.contentWindow!;
    const windowPost = vi.spyOn(child, 'postMessage');
    const port = documentPort();
    const post = port.postMessage;
    fireEvent.load(iframe);
    const session = new URL(iframe.src).hash.match(/mio-session=([^&]+)/)?.[1];
    expect(session).toBeTruthy();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: child,
          origin: 'null',
          data: { type: 'mio:panel:ready', version: BRIDGE.panel.version, session },
          ports: [port as unknown as MessagePort],
        }),
      );
    });
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.any(Object)));
    const init = post.mock.calls.find(([message]) => message.type === 'mio:panel:init')?.[0];
    expect(init).toEqual(
      expect.objectContaining({
        context: { episode_id: 'ep-1' },
        appearance: {
          tokens: { bg: '#17191b', accent: '#e0a070' },
          theme: 'dark',
          locale: 'zh-CN',
        },
      }),
    );

    post.mockClear();
    act(() => {
      root.dataset.theme = 'light';
      root.lang = 'en';
      root.style.setProperty('--bg', '#fcfbf7');
    });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mio:panel:appearance',
          appearance: {
            tokens: { bg: '#fcfbf7', accent: '#e0a070' },
            theme: 'light',
            locale: 'en',
          },
        }),
      ),
    );
    const update = post.mock.calls[0][0];
    expect(update).not.toHaveProperty('context');
    expect(windowPost).not.toHaveBeenCalled();
    view.unmount();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it('revokes the bridge and returns to a blank document after the panel navigates', () => {
    const view = renderWithProviders(<ExtensionFrame panel={panel} />);
    const iframe = view.getByTitle('Appearance probe') as HTMLIFrameElement;
    const child = iframe.contentWindow!;
    const windowPost = vi.spyOn(child, 'postMessage');
    const port = documentPort();
    const post = port.postMessage;
    const session = new URL(iframe.src).hash.match(/mio-session=([^&]+)/)?.[1];
    fireEvent.load(iframe);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: child,
          origin: 'null',
          data: { type: 'mio:panel:ready', version: BRIDGE.panel.version, session },
          ports: [port as unknown as MessagePort],
        }),
      );
    });
    expect(post).toHaveBeenCalledOnce();
    post.mockClear();
    fireEvent.load(iframe);
    expect(iframe.getAttribute('src')).toBe('about:blank');
    expect(port.close).toHaveBeenCalledOnce();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: child,
          origin: 'null',
          data: { type: 'mio:panel:ready', version: BRIDGE.panel.version, session },
          ports: [documentPort() as unknown as MessagePort],
        }),
      );
    });
    expect(post).not.toHaveBeenCalled();
    expect(windowPost).not.toHaveBeenCalled();
    view.unmount();
  });
});
