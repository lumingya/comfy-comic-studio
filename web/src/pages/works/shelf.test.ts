import { describe, expect, it } from 'vitest';
import type { SeriesCard } from '../../api/types';
import { series } from '../../test/fixtures';
import {
  filterShelf,
  manualIds,
  missingOf,
  moveId,
  reorderShelf,
  shelfDay,
  shelfState,
  type ShelfFacts,
  type ShelfQuery,
} from './shelf';

const card = (id: string, title: string, extra: Partial<SeriesCard> = {}): SeriesCard => ({
  ...(series as unknown as SeriesCard),
  id,
  title,
  subtitle: '',
  episode_count: 1,
  ...extra,
});

// a: complete, b: 3 of 4 scenes missing, c: complete, d: no panels yet.
const items = [
  card('a', '雨夜便利店', {
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
    panel_count: 3,
    adopted_count: 3,
  }),
  card('b', '晴天修理铺', {
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-27T00:00:00Z',
    subtitle: '番外',
    panel_count: 4,
    adopted_count: 1,
  }),
  card('c', 'Night Shift', {
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
    panel_count: 12,
    adopted_count: 12,
  }),
  card('d', '空白', {
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-10T00:00:00Z',
    panel_count: 0,
    adopted_count: 0,
  }),
];

const facts = (extra: Partial<ShelfFacts> = {}): ShelfFacts => ({
  starred: [],
  generating: new Set(),
  order: [],
  ...extra,
});
const all: ShelfQuery = { q: '', filter: 'all', sort: 'createdAt' };
const ids = (f: Partial<ShelfQuery>, x: Partial<ShelfFacts> = {}) =>
  filterShelf(items, { ...all, ...f }, facts(x), 'zh-CN').map((s) => s.id);

describe('shelf state (legacy shelfStatus)', () => {
  it('is 生成中 while a job runs, 待补齐 with scenes missing, otherwise 已完成', () => {
    expect(shelfState(items[1], true)).toBe('generating');
    expect(shelfState(items[1], false)).toBe('failed');
    expect(missingOf(items[1])).toBe(3);
    expect(shelfState(items[0], false)).toBe('complete');
    expect(shelfState(items[3], false)).toBe('blank');
  });
});

describe('filterShelf', () => {
  it('searches title, subtitle and 简介, case-insensitively', () => {
    expect(ids({ q: 'night' })).toEqual(['c']);
    expect(ids({ q: '番外' })).toEqual(['b']);
    const withSynopsis = [...items, card('e', '海边', { synopsis: '七海在海边停下脚步' })];
    expect(
      filterShelf(withSynopsis, { ...all, q: '停下脚步' }, facts(), 'zh-CN').map((s) => s.id),
    ).toEqual(['e']);
  });

  it('filters by the legacy 画册状态', () => {
    expect(ids({ filter: 'complete' })).toEqual(['a', 'c']);
    expect(ids({ filter: 'failed' })).toEqual(['b']);
    expect(ids({ filter: 'generating' })).toEqual([]);
    expect(ids({ filter: 'generating' }, { generating: new Set(['b']) })).toEqual(['b']);
    // 待补齐 keeps an album that is still generating, like legacy.
    expect(ids({ filter: 'failed' }, { generating: new Set(['b']) })).toEqual(['b']);
    expect(ids({ filter: 'complete' }, { generating: new Set(['a']) })).toEqual(['c']);
    expect(ids({ filter: 'starred' }, { starred: ['c', 'a'] })).toEqual(['a', 'c']);
  });

  it('sorts newest first, by last change, by panel count or in the dragged order', () => {
    expect(ids({})).toEqual(['b', 'a', 'd', 'c']);
    expect(ids({ sort: 'updatedAt' })).toEqual(['c', 'b', 'a', 'd']);
    expect(ids({ sort: 'totalSteps' })).toEqual(['c', 'b', 'a', 'd']);
    // Albums missing from the stored order follow it, newest first.
    expect(ids({ sort: 'manual' }, { order: ['c', 'gone', 'a'] })).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('manual order', () => {
  it('keeps the stored ids that still exist and appends the rest newest first', () => {
    expect(manualIds(items, ['d', 'x'])).toEqual(['d', 'b', 'a', 'c']);
  });

  it('moves an id before or after another', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b'], 'a', 'zz')).toEqual(['a', 'b']);
  });

  it('turns the shelf as displayed into the manual order before a drop', () => {
    // Shown newest first (b a d c); dropping c before a lands exactly there.
    expect(reorderShelf(items, ['b', 'a', 'd', 'c'], [], 'createdAt', 'c', 'a')).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
    // With a filter, hidden albums keep their slots: only b and c are shown (c b).
    expect(
      reorderShelf(items, ['c', 'b'], ['a', 'b', 'c', 'd'], 'updatedAt', 'c', 'b', true),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(
      reorderShelf(items, ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 'manual', 'a', 'd', true),
    ).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('shelfDay', () => {
  it('prints the local month and day like legacy dateFmt', () => {
    const iso = new Date(2026, 8, 13, 23, 30).toISOString();
    expect(shelfDay(iso, 'zh-CN')).toBe('09.13');
    expect(shelfDay('', 'zh-CN')).toBe('');
    expect(shelfDay('not a date', 'zh-CN')).toBe('');
  });
});
