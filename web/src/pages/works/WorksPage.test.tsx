import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { coverChoices } from './CoverPicker';
import WorksPage, { filterWorks } from './WorksPage';

const card = (id: string, title: string, extra: Partial<SeriesCard> = {}): SeriesCard => ({
  ...(series as unknown as SeriesCard),
  id,
  title,
  subtitle: '',
  episode_count: 0,
  ...extra,
});

const items = [
  card('a', '雨夜便利店', { status: 'active', updated_at: '2026-09-20T00:00:00' }),
  card('b', '晴天修理铺', { status: 'draft', updated_at: '2026-09-26T00:00:00', subtitle: '番外' }),
  card('c', 'Night Shift', { status: 'archived', updated_at: '2026-09-01T00:00:00' }),
];

describe('filterWorks', () => {
  it('matches title or subtitle, case-insensitively', () => {
    const f = { q: 'night', status: '' as const, sort: 'updated' as const };
    expect(filterWorks(items, f, 'en').map((s) => s.id)).toEqual(['c']);
    expect(filterWorks(items, { ...f, q: '番外' }, 'zh-CN').map((s) => s.id)).toEqual(['b']);
  });

  it('filters by status and sorts', () => {
    const all = { q: '', status: '' as const, sort: 'updated' as const };
    expect(filterWorks(items, all, 'zh-CN').map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(filterWorks(items, { ...all, status: 'active' }, 'zh-CN').map((s) => s.id)).toEqual([
      'a',
    ]);
    expect(filterWorks(items, { ...all, sort: 'title' }, 'en').map((s) => s.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
});

describe('WorksPage', () => {
  beforeEach(() => useUI.setState({ worksView: 'grid', starred: [] }));
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

    fireEvent.change(screen.getByDisplayValue('所有画册'), { target: { value: 'archived' } });
    expect(screen.queryByText('雨夜便利店')).toBeNull();
    expect(screen.getByText('Night Shift')).toBeInTheDocument();
  });
});

const routes = (extra: Record<string, unknown> = {}) => ({
  'GET /api/series': items,
  'GET /api/update': {},
  'GET /api/jobs': [],
  ...extra,
});

describe('WorksPage showcase', () => {
  beforeEach(() => useUI.setState({ worksView: 'showcase', starred: [] }));
  afterEach(() => vi.unstubAllGlobals());

  it('features one book at a time and leafs through with the buttons and arrow keys', async () => {
    mockFetch(routes());
    renderWithProviders(<WorksPage />);
    // Sorted by last update: 晴天修理铺, 雨夜便利店, Night Shift.
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
