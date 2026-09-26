import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeriesCard } from '../../api/types';
import { series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
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
  afterEach(() => vi.unstubAllGlobals());

  it('narrows the grid from the search box and offers to clear an empty result', async () => {
    mockFetch({ 'GET /api/series': items, 'GET /api/update': {}, 'GET /api/jobs': [] });
    renderWithProviders(<WorksPage />);
    expect(await screen.findByText('雨夜便利店')).toBeInTheDocument();
    expect(screen.getByText('Night Shift')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索作品'), { target: { value: '便利店' } });
    expect(screen.getByText('雨夜便利店')).toBeInTheDocument();
    expect(screen.queryByText('Night Shift')).toBeNull();

    fireEvent.change(screen.getByLabelText('搜索作品'), { target: { value: '不存在' } });
    expect(screen.getByText('没有符合条件的作品')).toBeInTheDocument();
    fireEvent.click(screen.getByText('清除筛选'));
    expect(screen.getByText('Night Shift')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /已完结/ }));
    expect(screen.queryByText('雨夜便利店')).toBeNull();
    expect(screen.getByText('Night Shift')).toBeInTheDocument();
  });
});
