import { act, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ThemeInfo } from '../../api/open';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ThemeSettingsPanel } from './ThemeSettingsPanel';

it('bridges isolated theme settings pages to their own preferences', async () => {
  const calls = mockFetch({
    'GET /api/themes/bridge-theme/preferences': { wallpaper_id: 'wallpaper_1' },
    'GET /api/themes/bridge-theme/wallpapers': { items: [] },
    'PUT /api/themes/bridge-theme/preferences': (body: unknown) => body,
  });
  const theme = {
    id: 'bridge-theme',
    name: 'Bridge theme',
    settings_page_url: '/api/themes/bridge-theme/settings-page',
  } as ThemeInfo;
  renderWithProviders(<ThemeSettingsPanel theme={theme} onClose={() => undefined} />);

  const frame = (await screen.findByTitle('Bridge theme')) as HTMLIFrameElement;
  const url = new URL(frame.src);
  const session = new URLSearchParams(url.hash.slice(1)).get('mio-theme-session');
  expect(session).toMatch(/^[a-f\d]{48}$/);

  const request = async (data: Record<string, unknown>) => {
    const response = new Promise<MessageEvent>((resolve) => {
      frame.contentWindow!.addEventListener('message', (event) => resolve(event as MessageEvent), {
        once: true,
      });
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'null',
          source: frame.contentWindow,
          data: { ...data, session },
        }),
      );
    });
    return (await response).data;
  };

  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: window,
        data: {
          type: 'mio:theme:request',
          requestId: 'wrong-source',
          action: 'updateSettings',
          settings: { wallpaper_id: 'wrong' },
          session,
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: frame.contentWindow,
        data: {
          type: 'mio:theme:request',
          requestId: 'wrong-session',
          action: 'updateSettings',
          settings: { wallpaper_id: 'wrong' },
          session: 'invalid-session',
        },
      }),
    );
  });
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');

  let initial: Record<string, unknown> = {};
  await waitFor(async () => {
    initial = await request({
      type: 'mio:theme:request',
      requestId: '1',
      action: 'getSettings',
    });
    expect(initial.settings).toEqual({ wallpaper_id: 'wallpaper_1' });
  });
  expect(initial).toMatchObject({
    type: 'mio:theme:response',
    requestId: '1',
    settings: { wallpaper_id: 'wallpaper_1' },
  });

  const updated = await request({
    type: 'mio:theme:request',
    requestId: '2',
    action: 'updateSettings',
    settings: { wallpaper_id: 'wallpaper_2' },
  });
  expect(updated).toMatchObject({
    type: 'mio:theme:response',
    requestId: '2',
    settings: { wallpaper_id: 'wallpaper_2' },
  });
  const current = await request({
    type: 'mio:theme:request',
    requestId: '3',
    action: 'getSettings',
  });
  expect(current).toMatchObject({
    type: 'mio:theme:response',
    requestId: '3',
    settings: { wallpaper_id: 'wallpaper_2' },
  });
  expect(calls.filter((call) => call.method === 'PUT')).toEqual([
    {
      method: 'PUT',
      url: '/api/themes/bridge-theme/preferences',
      body: { wallpaper_id: 'wallpaper_2' },
    },
  ]);
});
