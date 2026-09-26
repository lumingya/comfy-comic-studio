import { describe, expect, it } from 'vitest';
import { pushRecent, type RecentEpisode } from './recents';

const ep = (id: string, at = 0): RecentEpisode => ({
  id,
  title: id,
  seriesId: 's',
  seriesTitle: 'S',
  at,
});

describe('pushRecent', () => {
  it('puts the newest first and drops the earlier copy', () => {
    const list = pushRecent(pushRecent([], ep('a')), ep('b'));
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
    expect(pushRecent(list, ep('a', 9)).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps at most `max` entries', () => {
    let list: RecentEpisode[] = [];
    for (const id of ['a', 'b', 'c', 'd']) list = pushRecent(list, ep(id), 3);
    expect(list.map((r) => r.id)).toEqual(['d', 'c', 'b']);
  });
});
