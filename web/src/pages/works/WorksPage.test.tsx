import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { coverChoices } from './CoverPicker';
import WorksPage from './WorksPage';

const card = (id: string, title: string, extra: Partial<SeriesCard> = {}): SeriesCard => ({
  ...(series as unknown as SeriesCard),
  id,
  title,
  subtitle: '',
  episode_count: 0,
  ...extra,
});

// Newest first (the legacy default sort): 晴天修理铺, 雨夜便利店, Night Shift.
const items = [
  card('a', '雨夜便利店', {
    status: 'active',
    created_at: '2026-09-20T00:00:00',
    updated_at: '2026-09-20T00:00:00',
    panel_count: 3,
    adopted_count: 3,
  }),
  card('b', '晴天修理铺', {
    status: 'draft',
    created_at: '2026-09-26T00:00:00',
    updated_at: '2026-09-26T00:00:00',
    subtitle: '番外',
    panel_count: 4,
    adopted_count: 1,
  }),
  card('c', 'Night Shift', {
    status: 'archived',
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00',
    panel_count: 2,
    adopted_count: 2,
  }),
];

describe('WorksPage', () => {
  beforeEach(() =>
    useUI.setState({ worksView: 'grid', starred: [], shelfSort: 'createdAt', shelfOrder: [] }),
  );
  afterEach(() => vi.unstubAllGlobals());

  it('narrows the grid from the search box and offers to clear an empty result', async () => {
    mockFetch({ 'GET /api/series': items, 'GET /api/update': {}, 'GET /api/jobs': [] });
    renderWithProviders(<WorksPage />);
    expect(await screen.findByText('雨夜便利店')).toBeInTheDocument();
    expect(screen.getByText('Night Shift')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('寻找一本画册...'), { target: { value: '便利店' } });
    expect(screen.getByText('雨夜便利店')).toBeInTheDocument();
    expect(screen.queryByText('Night Shift')).toBeNull();

    fireEvent.change(screen.getByLabelText('寻找一本画册...'), { target: { value: '不存在' } });
    expect(screen.getByText('没有符合条件的作品')).toBeInTheDocument();
    fireEvent.click(screen.getByText('清除筛选'));
    expect(screen.getByText('Night Shift')).toBeInTheDocument();

    // Legacy 画册状态: 待补齐 lists albums with scenes still missing an image.
    fireEvent.change(screen.getByDisplayValue('所有画册'), { target: { value: 'failed' } });
    expect(screen.queryByText('雨夜便利店')).toBeNull();
    expect(screen.getByText('晴天修理铺')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('画册状态'), { target: { value: 'complete' } });
    expect(screen.getByText('Night Shift')).toBeInTheDocument();
    expect(screen.queryByText('晴天修理铺')).toBeNull();
  });

  it('shows each album as N 幕 · state · created day and sorts like legacy', async () => {
    mockFetch({ 'GET /api/series': items, 'GET /api/update': {}, 'GET /api/jobs': [] });
    renderWithProviders(<WorksPage />);
    const card = (await screen.findByText('晴天修理铺')).closest('article')!;
    expect(within(card).getByText('4 幕')).toBeInTheDocument();
    expect(within(card).getByText('待补齐')).toBeInTheDocument();
    expect(within(card).getByText('09.26')).toBeInTheDocument();
    const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles()).toEqual(['晴天修理铺', '雨夜便利店', 'Night Shift']);
    fireEvent.change(screen.getByLabelText('画册排序'), { target: { value: 'totalSteps' } });
    expect(titles()).toEqual(['晴天修理铺', '雨夜便利店', 'Night Shift']);
    expect(useUI.getState().shelfSort).toBe('totalSteps');
    fireEvent.change(screen.getByLabelText('画册排序'), { target: { value: 'manual' } });
    expect(titles()).toEqual(['晴天修理铺', '雨夜便利店', 'Night Shift']);
  });

  it('marks an album with a running render job as 生成中', async () => {
    mockFetch({
      'GET /api/series': items,
      'GET /api/update': {},
      'GET /api/jobs': [{ id: 'job_1', owner: 'ep_a', state: 'running', kind: 'render' }],
      'GET /api/series/a/episodes': { items: [{ id: 'ep_a' }], total: 1, offset: 0, limit: 50 },
      'GET /api/series/b/episodes': { items: [{ id: 'ep_b' }], total: 1, offset: 0, limit: 50 },
      'GET /api/series/c/episodes': { items: [{ id: 'ep_c' }], total: 1, offset: 0, limit: 50 },
    });
    renderWithProviders(<WorksPage />);
    const card = (await screen.findByText('雨夜便利店')).closest('article')!;
    expect(await within(card).findByText('生成中')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '生成中 · 1' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('画册状态'), { target: { value: 'generating' } });
    expect(screen.queryByText('Night Shift')).toBeNull();
    expect(screen.getByText('雨夜便利店')).toBeInTheDocument();
  });

  it('opens the album menu from ⋯ and moves an album in the manual order', async () => {
    mockFetch({ 'GET /api/series': items, 'GET /api/update': {}, 'GET /api/jobs': [] });
    renderWithProviders(<WorksPage />);
    const card = (await screen.findByText('Night Shift')).closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: '画册操作' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('2 幕 · 林夏 · 已齐备')).toBeInTheDocument();
    for (const label of [
      '翻开这本画册',
      '重命名…',
      '补齐缺失分幕',
      '导出离线画册…',
      '分享画册源文件…',
    ])
      expect(within(menu).getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /补齐缺失分幕/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /向后移动/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /向前移动/ }));
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['晴天修理铺', 'Night Shift', '雨夜便利店']);
    expect(useUI.getState().shelfSort).toBe('manual');
    expect(useUI.getState().shelfOrder).toEqual(['b', 'c', 'a']);
  });

  it('renames an album from its menu', async () => {
    const calls = mockFetch({
      'GET /api/series': items,
      'GET /api/update': {},
      'GET /api/jobs': [],
      'PATCH /api/series/a': (body: unknown) => ({ ...items[0], ...(body as object) }),
    });
    renderWithProviders(<WorksPage />);
    const card = (await screen.findByText('雨夜便利店')).closest('article')!;
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByRole('menuitem', { name: /重命名/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('画册名称'), { target: { value: '雨夜' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存名称' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: '雨夜' }),
    );
  });

  it('queues only the missing scenes from 补齐缺失分幕', async () => {
    const [p1, p2] = episode.panels;
    const ep = {
      ...episode,
      id: 'ep_b',
      series_id: 'b',
      panels: [p1, p2],
      takes: [{ ...episode.takes[0], id: 't1', panel_id: p1.id, status: 'adopted' }],
    } as Episode;
    const calls = mockFetch({
      'GET /api/series': items,
      'GET /api/update': {},
      'GET /api/jobs': [],
      'GET /api/series/b/episodes': { items: [{ id: 'ep_b' }], total: 1, offset: 0, limit: 50 },
      'GET /api/episodes/ep_b': ep,
      'POST /api/episodes/ep_b/render': { id: 'job_1', state: 'queued' },
    });
    renderWithProviders(<WorksPage />);
    const card = (await screen.findByText('晴天修理铺')).closest('article')!;
    fireEvent.contextMenu(card);
    fireEvent.click(await screen.findByRole('menuitem', { name: /补齐缺失分幕/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      panel_ids: [p2.id],
      candidates: 1,
      adopt_first: true,
    });
  });
});

const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /api/series': items,
  'GET /api/update': {},
  'GET /api/jobs': [],
  ...extra,
});

describe('WorksPage showcase', () => {
  beforeEach(() =>
    useUI.setState({ worksView: 'showcase', starred: [], shelfSort: 'createdAt', shelfOrder: [] }),
  );
  afterEach(() => vi.unstubAllGlobals());

  it('features one book at a time and leafs through with the buttons and arrow keys', async () => {
    mockFetch(routes());
    renderWithProviders(<WorksPage />);
    // Newest first: 晴天修理铺, 雨夜便利店, Night Shift.
    expect(
      await screen.findByRole('heading', { level: 2, name: '晴天修理铺' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Night Shift')).toBeNull();
    expect(screen.getByText('3 本画册')).toBeInTheDocument();
    expect(screen.getByText('01 / 03')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一册' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '翻开这本画册' })).toHaveAttribute(
      'href',
      '/gallery/b',
    );

    fireEvent.click(screen.getByRole('button', { name: '下一册' }));
    expect(screen.getByRole('heading', { level: 2, name: '雨夜便利店' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { level: 2, name: 'Night Shift' })).toBeInTheDocument();
    expect(screen.getByText('03 / 03')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一册' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('02 / 03')).toBeInTheDocument();

    // 紧凑网格 shows the whole shelf, and the choice is remembered.
    fireEvent.click(screen.getByRole('button', { name: /紧凑网格/ }));
    expect(screen.getByText('Night Shift')).toBeInTheDocument();
    expect(screen.getByText('晴天修理铺')).toBeInTheDocument();
    expect(useUI.getState().worksView).toBe('grid');
  });

  it('names the collection 遇见你，真好 by default and renames it in place', async () => {
    const calls = mockFetch(
      routes({ 'PATCH /api/settings': (body: unknown) => ({ ...(body as object) }) }),
    );
    renderWithProviders(<WorksPage />);
    const title = await screen.findByLabelText('重命名画册集');
    expect(title).toHaveValue('遇见你，真好');
    fireEvent.change(title, { target: { value: '夏日画册' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        collection_title: '夏日画册',
      }),
    );
  });

  it('stars a book and filters the shelf to starred ones', async () => {
    mockFetch(routes());
    renderWithProviders(<WorksPage />);
    await screen.findByRole('heading', { level: 2, name: '晴天修理铺' });
    fireEvent.click(screen.getByRole('button', { name: '星标收藏' }));
    expect(useUI.getState().starred).toEqual(['b']);
    expect(screen.getByRole('button', { name: '取消星标' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: /^星标$/ }));
    expect(screen.getByText('1 本画册')).toBeInTheDocument();
    expect(screen.getByText('01 / 01')).toBeInTheDocument();
  });

  it('picks a cover from the book’s images and can go back to the automatic one', async () => {
    const ep = {
      ...episode,
      series_id: 'b',
      takes: [
        { ...episode.takes[0], id: 't1', asset_id: 'img_first', status: 'candidate' },
        { ...episode.takes[0], id: 't2', asset_id: 'img_second', status: 'adopted' },
      ].map((t, i) => ({ ...t, panel_id: episode.panels[i % episode.panels.length].id })),
    } as Episode;
    const withCover = items.map((s) =>
      s.id === 'b' ? { ...s, cover_asset_id: 'img_second', cover_auto: false } : s,
    );
    const calls = mockFetch(
      routes({
        'GET /api/series': withCover,
        'GET /api/series/b/episodes': { items: [{ id: ep.id }], total: 1, offset: 0, limit: 50 },
        [`GET /api/episodes/${ep.id}`]: ep,
        'PATCH /api/series/b': (body: unknown) => ({ ...withCover[1], ...(body as object) }),
      }),
    );
    renderWithProviders(<WorksPage />);
    await screen.findByRole('heading', { level: 2, name: '晴天修理铺' });
    fireEvent.click(screen.getByRole('button', { name: /更换封面/ }));
    const dialog = await screen.findByRole('dialog');
    const current = await within(dialog).findByRole('option', { selected: true });
    expect(within(current).getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining('img_second'),
    );

    fireEvent.click(within(dialog).getAllByRole('option')[0]);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        cover_asset_id: 'img_first',
      }),
    );
  });
});

describe('coverChoices', () => {
  it('lists usable images in reading order, skipping rejected and variant takes', () => {
    const [p1, p2] = episode.panels;
    const take = episode.takes[0];
    const ep = {
      ...episode,
      panels: [
        { ...p1, order: 1 },
        { ...p2, order: 0 },
      ],
      takes: [
        { ...take, id: 'a', panel_id: p1.id, asset_id: 'late', status: 'adopted' },
        { ...take, id: 'b', panel_id: p2.id, asset_id: 'early', status: 'candidate' },
        { ...take, id: 'c', panel_id: p2.id, asset_id: 'nope', status: 'rejected' },
        { ...take, id: 'd', panel_id: p2.id, asset_id: 'alt', variant_id: 'v1' },
        { ...take, id: 'e', panel_id: 'gone', asset_id: 'orphan' },
      ],
    } as Episode;
    expect(coverChoices([ep]).map((c) => [c.asset_id, c.adopted])).toEqual([
      ['early', false],
      ['late', true],
    ]);
  });
});
