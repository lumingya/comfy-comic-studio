import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Series } from '../../api/types';
import { keys } from '../../api/keys';
import { workshopKey } from '../../api/workshop';
import { confirm } from '../../components/confirm';
import { episode, series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import PresetsTab from './PresetsTab';
import { StoryBody, StoryIndex, StoryTab } from './WorkshopPage';

vi.mock('../../components/confirm', () => ({
  confirm: vi.fn().mockResolvedValue(false),
  promptText: vi.fn().mockResolvedValue(null),
}));

const preset = (id: string, value: string) => ({
  id,
  title: `${id} preset`,
  groups: [],
  bindings: [],
  entries: [
    { id: `${id}_entry`, key: 'hero', label: 'Hero prompt', value, hint: '', group_id: null },
  ],
});
let workshop: Series;
let kit: Series;
let board: Episode;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(confirm).mockReset().mockResolvedValue(false);
  workshop = {
    ...structuredClone(series),
    id: 'ws',
    kind: 'workshop',
    title: 'My library',
    presets: [preset('local', 'local hero')],
  };
  kit = {
    ...structuredClone(series),
    id: 'kit',
    kind: 'kit',
    title: 'Rain kit',
    variables: { setting: 'kit setting' },
    presets: [preset('imported', 'kit hero')],
  };
  board = {
    ...structuredClone(episode),
    id: 'kit_board',
    series_id: 'kit',
    title: 'Kit story',
    base_prompt: 'kit base',
    synopsis: 'kit synopsis',
  };
});
afterEach(() => vi.unstubAllGlobals());

const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /api/workshop': () => workshop,
  'GET /api/creation-kits': () => [kit],
  'GET /api/series/kit': () => kit,
  'GET /api/series': [],
  'GET /api/profiles': [],
  'GET /api/series/ws/episodes': { items: [], total: 0 },
  'GET /api/series/kit/episodes': () => ({
    items: [{ id: board.id, title: board.title, panel_count: board.panels.length }],
    total: 1,
  }),
  'GET /api/episodes/kit_board': () => board,
  'PATCH /api/series/kit': (body: unknown) => {
    kit = { ...kit, ...(body as object) };
    return kit;
  },
  'PATCH /api/episodes/kit_board': (body: unknown) => {
    board = { ...board, ...(body as object), revision: board.revision + 1 };
    return board;
  },
  'PATCH /api/episodes/kit_board/panels/p0': (body: unknown) => {
    board = {
      ...board,
      revision: board.revision + 1,
      panels: board.panels.map((p) =>
        p.id === 'p0' ? { ...p, ...(body as { changes: object }).changes } : p,
      ),
    };
    return board;
  },
  ...extra,
});

function mount(path = '/workshop/presets?kit=kit') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(workshopKey, workshop);
  const router = createMemoryRouter(
    [
      { path: '/workshop/presets', element: <PresetsTab /> },
      { path: '/workshop/story', element: <StoryIndex /> },
      {
        path: '/workshop/story/:episodeId',
        element: <StoryTab />,
        children: [{ index: true, element: <StoryBody /> }],
      },
      { path: '/workshop/assembly', element: <p>Assembly</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, qc };
}

describe('workshop creation-kit sources', () => {
  it('waits for a kit save before switching, preserves the default library and does not reuse the draft', async () => {
    let finish!: () => void;
    const calls = mockFetch(
      routes({
        'PATCH /api/series/kit': async (body: unknown) => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          kit = { ...kit, ...(body as object) };
          return kit;
        },
      }),
    );
    const { router, qc } = mount();
    const input = await screen.findByLabelText('Hero prompt');
    fireEvent.change(input, { target: { value: 'edited kit hero' } });
    fireEvent.change(screen.getByLabelText('当前资料'), { target: { value: '' } });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(router.state.location.search).toBe('?kit=kit');
    expect(screen.getByLabelText('当前资料')).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByLabelText('Hero prompt')).toHaveValue('local hero'));
    expect(qc.getQueryData(workshopKey)).toEqual(workshop);
    expect(qc.getQueryData<Series>(keys.series('kit'))?.presets[0].entries[0].value).toBe(
      'edited kit hero',
    );
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.url)).toEqual([
      '/api/series/kit',
    ]);
    fireEvent.change(screen.getByLabelText('当前资料'), { target: { value: 'kit' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Hero prompt')).toHaveValue('edited kit hero'),
    );
  });

  it('keeps a failed preset draft and source rather than falling back to the default workshop', async () => {
    const calls = mockFetch(
      routes({
        'PATCH /api/series/kit': () =>
          new Response(JSON.stringify({ detail: 'offline' }), { status: 503 }),
      }),
    );
    const { router } = mount();
    fireEvent.change(await screen.findByLabelText('Hero prompt'), {
      target: { value: 'keep this' },
    });
    fireEvent.change(screen.getByLabelText('当前资料'), { target: { value: '' } });
    await screen.findByText('保存失败（Ctrl+S 重试）');
    expect(router.state.location.search).toBe('?kit=kit');
    expect(screen.getByLabelText('Hero prompt')).toHaveValue('keep this');
    expect(calls.some((call) => call.url === '/api/workshop')).toBe(false);
  });

  it('retains the kit query when adding a preset and isolates remembered selections by source', async () => {
    const calls = mockFetch(routes());
    const { router } = mount('/workshop/presets?kit=kit&new=1');
    await waitFor(() => expect(kit.presets).toHaveLength(2));
    expect(router.state.location.search).toBe('?kit=kit');
    expect(localStorage.getItem('mio.workshop.preset.kit')).toBe(kit.presets[1].id);
    expect(localStorage.getItem('mio.workshop.preset.ws')).toBeNull();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('does not treat an unavailable or non-kit series as the default source', async () => {
    const calls = mockFetch(routes({ 'GET /api/series/kit': { ...kit, kind: 'album' } }));
    mount();
    await screen.findByText(/这份套装不存在或已移除，请选择其他资料。/);
    expect(screen.queryByLabelText('Hero prompt')).toBeNull();
    expect(screen.getByLabelText('当前资料')).toHaveValue('kit');
    expect(calls.some((call) => call.url === '/api/workshop' || call.method === 'PATCH')).toBe(
      false,
    );
  });

  it('flushes synopsis and the active frame together before switching source, preserving each target', async () => {
    const calls = mockFetch(routes());
    const { router } = mount('/workshop/story/kit_board?kit=kit');
    await screen.findByDisplayValue('kit synopsis');
    fireEvent.change(document.getElementById('workshop-outline')!, {
      target: { value: 'revised kit outline' },
    });
    fireEvent.change(document.getElementById('workshop-base-prompt')!, {
      target: { value: 'revised kit base' },
    });
    fireEvent.change(document.getElementById('workshop-frame-prompt')!, {
      target: { value: 'kit frame change' },
    });
    fireEvent.change(screen.getByLabelText('当前资料'), { target: { value: '' } });
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe('/workshop/story'),
    );
    expect(board.synopsis).toBe('revised kit outline');
    expect(board.base_prompt).toBe('revised kit base');
    expect(board.panels[0].overrides.raw_prompt).toBe('kit frame change');
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.url)).toEqual([
      '/api/episodes/kit_board',
      '/api/episodes/kit_board/panels/p0',
    ]);
  });

  it('blocks a search-only route change when the synopsis save fails, even with a frame editor mounted', async () => {
    mockFetch(
      routes({
        'PATCH /api/episodes/kit_board': () =>
          new Response(JSON.stringify({ detail: 'offline' }), { status: 503 }),
      }),
    );
    const { router } = mount('/workshop/story/kit_board?kit=kit');
    await screen.findByDisplayValue('kit synopsis');
    fireEvent.change(document.getElementById('workshop-outline')!, {
      target: { value: 'keep outline' },
    });
    await act(() => router.navigate('/workshop/story/kit_board?kit=other'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(router.state.location.search).toBe('?kit=kit');
    expect(document.getElementById('workshop-outline')).toHaveValue('keep outline');
  });

  it('uses the kit for prompt completion and keeps its source when moving to presets or assembly', async () => {
    workshop.variables = { local_only: 'not in the kit' };
    board.panels[0].overrides.raw_prompt = '{hero}, {setting}, {local_only}';
    mockFetch(routes());
    const { router } = mount('/workshop/story/kit_board?kit=kit');
    await screen.findByDisplayValue('kit synopsis');
    expect(document.querySelector('[data-prompt-variable="setting"]')).toHaveAttribute(
      'data-state',
      'defined',
    );
    expect(document.querySelector('[data-prompt-variable="local_only"]')).toHaveAttribute(
      'data-state',
      'unknown',
    );
    fireEvent.click(screen.getByRole('button', { name: '预设工坊' }));
    await screen.findByDisplayValue('kit hero');
    expect(router.state.location.search).toBe('?kit=kit');
    fireEvent.click(screen.getByRole('button', { name: '分镜工坊' }));
    await screen.findByDisplayValue('kit synopsis');
    fireEvent.click(screen.getByRole('button', { name: '去装配此分镜' }));
    await screen.findByText('Assembly');
    expect(new URLSearchParams(router.state.location.search).get('kit')).toBe('kit');
    expect(new URLSearchParams(router.state.location.search).get('story')).toBe('kit_board');
  });

  it('submits independent preset preview to the kit API only after saving the current preset', async () => {
    const calls = mockFetch(
      routes({ 'POST /api/creation-kits/kit/preview-preset': { series, episode } }),
    );
    const { router } = mount();
    fireEvent.change(await screen.findByLabelText('Hero prompt'), {
      target: { value: 'preview hero' },
    });
    fireEvent.click(screen.getByRole('button', { name: '独立试绘' }));
    fireEvent.click(screen.getByRole('button', { name: '添加待命试绘' }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/preview-preset'))).toBe(true),
    );
    const mutations = calls.filter((call) => call.method !== 'GET');
    expect(mutations.map((call) => call.url)).toEqual([
      '/api/series/kit',
      '/api/creation-kits/kit/preview-preset',
    ]);
    expect(mutations[1].body).toMatchObject({ preset_ids: ['imported'], prompt: '{hero}' });
    await screen.findByText('Assembly');
    expect(router.state.location.search).toBe('?kit=kit');
  });
});
