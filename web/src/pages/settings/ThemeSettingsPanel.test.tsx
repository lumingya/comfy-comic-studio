import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThemeInfo } from '../../api/open';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ThemeSettingsPanel } from './ThemeSettingsPanel';

afterEach(() => vi.unstubAllGlobals());

function queuePreferences() {
  let saved: Record<string, unknown> = { first: false, second: false };
  let revision = 0;
  const response = () =>
    new Response(JSON.stringify(saved), {
      headers: {
        'Content-Type': 'application/json',
        ETag: `"${revision.toString(16).padStart(64, '0')}"`,
      },
    });
  const puts: { value: Record<string, unknown>; respond: (success?: boolean) => void }[] = [];
  mockFetch({
    'GET /api/themes/serial-theme/preferences': response,
    'GET /api/themes/serial-theme/wallpapers': { items: [] },
    'PATCH /api/themes/serial-theme/preferences': (body: unknown) =>
      new Promise((resolve) => {
        const intent = body as { path: string[]; value: unknown };
        const value = intent.path.length
          ? { ...saved, [intent.path[0]]: intent.value }
          : (intent.value as Record<string, unknown>);
        puts.push({
          value,
          respond: (success = true) => {
            if (success) {
              saved = value;
              revision += 1;
              resolve(response());
            } else {
              resolve(
                new Response(JSON.stringify({ detail: 'Failed preference save' }), {
                  status: 500,
                  headers: { 'content-type': 'application/json' },
                }),
              );
            }
          },
        });
      }),
  });
  return { puts, saved: () => saved };
}

const serialTheme: ThemeInfo = {
  id: 'serial-theme',
  name: 'Serial theme',
  mode: 'dark',
  author: '',
  source: 'user',
  tokens: {},
  settings_schema: [
    { id: 'first', type: 'switch', label: 'First', default: false },
    { id: 'second', type: 'switch', label: 'Second', default: false },
  ],
};

it('bridges isolated theme settings pages to their own preferences', async () => {
  const response = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', ETag: `"${'a'.repeat(64)}"` },
    });
  const calls = mockFetch({
    'GET /api/themes/bridge-theme/preferences': response({ wallpaper_id: 'wallpaper_1' }),
    'GET /api/themes/bridge-theme/wallpapers': { items: [] },
    'PATCH /api/themes/bridge-theme/preferences': (body: unknown) =>
      response((body as { value: unknown }).value),
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
  expect(calls.filter((call) => call.method === 'PATCH')).toEqual([
    {
      method: 'PATCH',
      url: '/api/themes/bridge-theme/preferences',
      body: { expected_revision: 'a'.repeat(64), path: [], value: { wallpaper_id: 'wallpaper_2' } },
    },
  ]);
});

it.each([true, false])(
  'serializes rapid saves and preserves the latest draft when an earlier request succeeds=%s',
  async (firstSucceeds) => {
    const requests = queuePreferences();
    const view = renderWithProviders(
      <ThemeSettingsPanel theme={serialTheme} onClose={() => undefined} />,
    );
    const first = await screen.findByRole('checkbox', { name: 'First' });
    const second = screen.getByRole('checkbox', { name: 'Second' });
    await waitFor(() => expect(screen.queryByText('加载中…')).not.toBeInTheDocument());
    fireEvent.click(first);
    await waitFor(() => expect(requests.puts).toHaveLength(1));
    await act(async () => fireEvent.click(second));
    expect(first).toBeChecked();
    expect(second).toBeChecked();
    expect(requests.puts).toHaveLength(1);

    await act(async () => requests.puts[0].respond(firstSucceeds));
    await waitFor(() => expect(requests.puts).toHaveLength(2));
    expect(second).toBeChecked();
    expect(requests.puts[1].value).toEqual({ first: firstSucceeds, second: true });
    await act(async () => requests.puts[1].respond());
    await waitFor(() => expect(requests.saved()).toEqual({ first: firstSucceeds, second: true }));
    expect(second).toBeChecked();

    view.unmount();
    renderWithProviders(<ThemeSettingsPanel theme={serialTheme} onClose={() => undefined} />);
    await waitFor(() => {
      expect((screen.getByRole('checkbox', { name: 'First' }) as HTMLInputElement).checked).toBe(
        firstSucceeds,
      );
      expect(screen.getByRole('checkbox', { name: 'Second' })).toBeChecked();
    });
  },
);

it('restores the last confirmed server value if the newest queued save fails', async () => {
  const requests = queuePreferences();
  renderWithProviders(<ThemeSettingsPanel theme={serialTheme} onClose={() => undefined} />);
  const first = await screen.findByRole('checkbox', { name: 'First' });
  const second = screen.getByRole('checkbox', { name: 'Second' });
  await waitFor(() => expect(screen.queryByText('加载中…')).not.toBeInTheDocument());
  fireEvent.click(first);
  await waitFor(() => expect(requests.puts).toHaveLength(1));
  await act(async () => fireEvent.click(second));
  await act(async () => requests.puts[0].respond());
  await waitFor(() => expect(requests.puts).toHaveLength(2));
  expect(second).toBeChecked();
  await act(async () => requests.puts[1].respond(false));
  await waitFor(() => expect(second).not.toBeChecked());
  expect(first).toBeChecked();
  expect(requests.saved()).toEqual({ first: true, second: false });
});

it('keeps isolated page reads on the latest queued settings after an earlier save completes', async () => {
  const requests = queuePreferences();
  renderWithProviders(
    <ThemeSettingsPanel
      theme={{ ...serialTheme, settings_page_url: '/api/themes/serial-theme/settings-page' }}
      onClose={() => undefined}
    />,
  );
  const frame = (await screen.findByTitle('Serial theme')) as HTMLIFrameElement;
  const session = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('mio-theme-session');
  const responses: Record<string, unknown>[] = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message) => {
    responses.push(message);
  });
  const request = async (requestId: string, settings?: Record<string, unknown>) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'null',
          source: frame.contentWindow,
          data: {
            type: 'mio:theme:request',
            session,
            requestId,
            action: settings ? 'updateSettings' : 'getSettings',
            settings,
          },
        }),
      );
    });
  };
  await request('first', { first: true, second: false });
  await waitFor(() => expect(requests.puts).toHaveLength(1));
  await request('second', { first: true, second: true });
  expect(requests.puts).toHaveLength(1);
  await act(async () => requests.puts[0].respond());
  await waitFor(() => expect(requests.puts).toHaveLength(2));
  await request('current');
  expect(responses.find((response) => response.requestId === 'current')).toMatchObject({
    settings: { first: true, second: true },
  });
  await act(async () => requests.puts[1].respond());
  await request('saved');
  expect(responses.find((response) => response.requestId === 'saved')).toMatchObject({
    settings: { first: true, second: true },
  });
});

it('keeps an uncommitted slider draft while a background refresh changes a different field', async () => {
  const requests = queuePreferences();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeSettingsPanel
        theme={{
          ...serialTheme,
          settings_schema: [
            ...serialTheme.settings_schema!,
            { id: 'level', type: 'slider', label: 'Level', min: 0, max: 10, default: 0 },
          ],
        }}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const slider = screen.getByRole('slider', { name: /^Level/ });
  fireEvent.change(slider, { target: { value: '7' } });
  act(() =>
    client.setQueryData(['theme-preferences', serialTheme.id], {
      first: true,
      second: false,
      level: 2,
    }),
  );
  await waitFor(() => {
    expect(slider).toHaveValue('7');
    expect(screen.getByRole('checkbox', { name: 'First' })).toBeChecked();
  });
  fireEvent.pointerUp(slider);
  await waitFor(() => expect(requests.puts).toHaveLength(1));
  expect(requests.puts[0].value.level).toBe(7);
  await act(async () => requests.puts[0].respond());
  expect(slider).toHaveValue('7');
});

it('does not post a late settings response into an unmounted iframe', async () => {
  const requests = queuePreferences();
  const view = renderWithProviders(
    <ThemeSettingsPanel
      theme={{ ...serialTheme, settings_page_url: '/api/themes/serial-theme/settings-page' }}
      onClose={() => undefined}
    />,
  );
  const frame = (await screen.findByTitle('Serial theme')) as HTMLIFrameElement;
  const session = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('mio-theme-session');
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: frame.contentWindow,
        data: {
          type: 'mio:theme:request',
          session,
          requestId: 'late',
          action: 'updateSettings',
          settings: { first: true },
        },
      }),
    ),
  );
  await waitFor(() => expect(requests.puts).toHaveLength(1));
  view.unmount();
  await act(async () => requests.puts[0].respond());
  expect(post).not.toHaveBeenCalled();
  expect(requests.saved()).toEqual({ first: true });
});
