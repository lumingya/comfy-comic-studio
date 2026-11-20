import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Strip } from '../../api/types';
import { ConfirmHost } from '../../components/confirm';
import i18n from '../../i18n';
import { episode, series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import CanvasTab from './CanvasTab';
import type { StripStage } from './StripStage';

vi.mock('./useImage', () => ({ useImage: () => ({ width: 1600, height: 900 }) }));
vi.mock('./StripStage', () => ({
  StripStage: (props: ComponentProps<typeof StripStage>) => (
    <output data-testid="strip">{JSON.stringify(props.strip)}</output>
  ),
}));
afterEach(() => vi.unstubAllGlobals());

function mount(routes: Record<string, unknown> = {}) {
  const initial = { ...episode, revision: 3 };
  let receive!: (next: Episode) => void;
  function Context() {
    const [value, setValue] = useState(initial);
    receive = setValue;
    return <Outlet context={{ episode: value, series }} />;
  }
  const calls = mockFetch({
    'GET /api/episodes/ep_1/strip/report': { readable: true },
    ...routes,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([
    {
      element: <Context />,
      children: [
        { path: '/', element: <CanvasTab /> },
        { path: '/away', element: <div>away</div> },
      ],
    },
  ]);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <ConfirmHost />
    </QueryClientProvider>,
  );
  return { calls, receive: (next: Episode) => act(() => receive(next)), initial, router };
}

const width = () => screen.getByLabelText(i18n.t('canvas.width'));
const save = () => screen.getByRole('button', { name: i18n.t('common.save') });
const strip = (): Strip => JSON.parse(screen.getByTestId('strip').textContent!);

describe('canvas revision ownership', () => {
  it('keeps a dirty draft on its original revision after a newer episode arrives', async () => {
    const { calls, receive, initial } = mount({
      'PUT /api/episodes/ep_1/strip': () =>
        new Response(JSON.stringify({ detail: 'episode changed' }), { status: 409 }),
    });
    fireEvent.change(width(), { target: { value: '900' } });
    receive({ ...initial, revision: 4, strip: { ...initial.strip, background: '#123456' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
      url: '/api/episodes/ep_1/strip?base_revision=3',
      body: { width: 900, background: '#ffffff' },
    });
    await waitFor(() => expect(save()).toBeEnabled());
    expect(strip()).toMatchObject({ width: 900, background: '#ffffff' });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
    expect(width()).toHaveValue(800);
  });

  it('accepts a new clean baseline even when only non-strip episode data changed', async () => {
    const { calls, receive, initial } = mount({
      'PUT /api/episodes/ep_1/strip': { ...episode.strip, width: 900 },
    });
    receive({ ...initial, revision: 4, title: 'New title' });
    fireEvent.change(width(), { target: { value: '900' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')!.url).toBe(
      '/api/episodes/ep_1/strip?base_revision=4',
    );
  });

  it('bases the layout after pacing on the pacing receipt before props refetch', async () => {
    const { calls } = mount({
      'POST /api/episodes/ep_1/pacing/suggest': {
        revision: 3,
        suggestions: [{ panel_id: 'p0', order: 0, changes: { gap_after: 288 }, reasons: [] }],
      },
      'POST /api/episodes/ep_1/pacing/apply': { ...episode, revision: 4 },
      'POST /api/episodes/ep_1/strip/layout': { ...episode.strip, height: 1800 },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pacing.open') }));
    fireEvent.click(
      await screen.findByRole('button', { name: i18n.t('pacing.applyN', { count: 1 }) }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/strip/layout'))).toBe(true),
    );
    expect(calls.find((call) => call.url.includes('/strip/layout'))!.url).toBe(
      '/api/episodes/ep_1/strip/layout?base_revision=4',
    );
    await waitFor(() => expect(strip().height).toBe(1800));
  });

  it.each([true, false])(
    'keeps edits around a pacing receipt when a newer refetch arrives (edit first: %s)',
    async (editFirst) => {
      let finish!: (value: unknown) => void;
      const { calls, receive, initial } = mount({
        'POST /api/episodes/ep_1/pacing/suggest': {
          revision: 3,
          suggestions: [{ panel_id: 'p0', order: 0, changes: { gap_after: 288 }, reasons: [] }],
        },
        'POST /api/episodes/ep_1/pacing/apply': () => new Promise((resolve) => (finish = resolve)),
        'POST /api/episodes/ep_1/strip/layout': episode.strip,
        'PUT /api/episodes/ep_1/strip': () =>
          new Response(JSON.stringify({ detail: 'episode changed' }), { status: 409 }),
      });
      fireEvent.click(screen.getByRole('button', { name: i18n.t('pacing.open') }));
      fireEvent.click(
        await screen.findByRole('button', { name: i18n.t('pacing.applyN', { count: 1 }) }),
      );
      await waitFor(() => expect(finish).toBeTypeOf('function'));
      if (editFirst) fireEvent.change(width(), { target: { value: '900' } });
      receive({ ...initial, revision: 5, strip: { ...initial.strip, background: '#123456' } });
      if (!editFirst) fireEvent.change(width(), { target: { value: '900' } });
      await act(async () => finish({ ...initial, revision: 4 }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(strip()).toMatchObject({
        width: 900,
        background: editFirst ? '#ffffff' : '#123456',
      });
      expect(calls.some((call) => call.url.includes('/strip/layout'))).toBe(false);
      fireEvent.click(save());
      await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
      expect(calls.find((call) => call.method === 'PUT')!.url).toBe(
        `/api/episodes/ep_1/strip?base_revision=${editFirst ? 3 : 5}`,
      );
      await waitFor(() => expect(save()).toBeEnabled());
    },
  );

  it.each(['save', 'layout'] as const)(
    'binds continued edits to the successful %s receipt despite a newer refetch',
    async (action) => {
      let finish!: (value: unknown) => void;
      const pending = () => new Promise((resolve) => (finish = resolve));
      const { calls, receive, initial } = mount({
        'POST /api/episodes/ep_1/strip/layout': pending,
        'PUT /api/episodes/ep_1/strip': (body: Strip) => {
          if (action === 'save' && body.width === 900) return pending();
          return new Response(JSON.stringify({ detail: 'episode changed' }), { status: 409 });
        },
      });
      const savedWidth = action === 'save' ? 900 : 800;
      if (action === 'save') {
        fireEvent.change(width(), { target: { value: '900' } });
        fireEvent.click(save());
      } else fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.relayoutAll') }));
      await waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(calls.find((call) => call.method !== 'GET')!.url).toBe(
        `/api/episodes/ep_1/strip${action === 'layout' ? '/layout' : ''}?base_revision=3`,
      );
      fireEvent.change(width(), { target: { value: '1000' } });
      receive({ ...initial, revision: 5, strip: { ...initial.strip, background: '#123456' } });
      await act(async () => finish({ ...initial.strip, width: savedWidth, height: 1800 }));
      await waitFor(() => expect(save()).toBeEnabled());
      expect(strip()).toMatchObject({ width: 1000, background: '#ffffff' });
      // A late copy of the old episode must not undo the acknowledged CAS baseline either.
      receive({ ...initial });
      fireEvent.click(save());
      await waitFor(() =>
        expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(
          action === 'save' ? 2 : 1,
        ),
      );
      expect(calls.filter((call) => call.method === 'PUT').at(-1)!.url).toBe(
        '/api/episodes/ep_1/strip?base_revision=4',
      );
      await waitFor(() => expect(save()).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
      expect(strip()).toMatchObject({ width: savedWidth, height: 1800 });
      expect(save()).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.redo') }));
      expect(width()).toHaveValue(1000);
      expect(save()).toBeEnabled();
    },
  );

  it('receives the latest clean server snapshot after a pending save settles', async () => {
    let finish!: (value: unknown) => void;
    const { calls, receive, initial } = mount({
      'PUT /api/episodes/ep_1/strip': () => new Promise((resolve) => (finish = resolve)),
    });
    fireEvent.change(width(), { target: { value: '900' } });
    fireEvent.click(save());
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const remote = { ...initial.strip, width: 1100, background: '#123456' };
    receive({ ...initial, revision: 5, strip: remote });
    await act(async () => finish({ ...initial.strip, width: 900 }));
    await waitFor(() => expect(width()).toHaveValue(1100));
    expect(strip().background).toBe('#123456');
    fireEvent.change(width(), { target: { value: '1200' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'PUT').at(-1)!.url).toBe(
      '/api/episodes/ep_1/strip?base_revision=5',
    );
    await act(async () => finish({ ...remote, width: 1200 }));
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it('keeps the draft when navigation is cancelled and reloads the baseline after leaving', async () => {
    const { calls, receive, initial, router } = mount({
      'PUT /api/episodes/ep_1/strip': () =>
        new Response(JSON.stringify({ detail: 'episode changed' }), { status: 409 }),
    });
    fireEvent.change(width(), { target: { value: '900' } });
    const remote = { ...initial, revision: 4, strip: { ...initial.strip, background: '#123456' } };
    receive(remote);
    await act(async () => void router.navigate('/away'));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(width()).toHaveValue(900);
    fireEvent.click(save());
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(calls.find((call) => call.method === 'PUT')!.url).toBe(
      '/api/episodes/ep_1/strip?base_revision=3',
    );
    await waitFor(() => expect(save()).toBeEnabled());
    await act(async () => void router.navigate('/away'));
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('common.leave') }));
    await screen.findByText('away');
    await act(async () => void router.navigate('/'));
    expect(strip()).toMatchObject({ width: 800, background: '#123456' });
    fireEvent.change(width(), { target: { value: '1000' } });
    fireEvent.click(save());
    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'PUT').at(-1)!.url).toBe(
      '/api/episodes/ep_1/strip?base_revision=4',
    );
    await waitFor(() => expect(save()).toBeEnabled());
  });
});
