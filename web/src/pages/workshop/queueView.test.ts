import { describe, expect, it } from 'vitest';
import {
  headlineTitle,
  moveId,
  orderByQueue,
  overridesSummary,
  pageNumbers,
  paging,
  shiftId,
} from './queueView';

describe('orderByQueue', () => {
  const items = [
    { id: 'c', at: '2026-01-03' },
    { id: 'a', at: '2026-01-01' },
    { id: 'n', at: '2026-01-09' },
    { id: 'b', at: '2026-01-02' },
  ];
  it('follows the server order and appends unlisted albums oldest first', () => {
    const out = orderByQueue(
      items,
      ['b', 'c'],
      (x) => x.id,
      (x) => x.at,
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'c', 'a', 'n']);
  });
});

describe('moveId / shiftId', () => {
  it('drops a card before or after another one', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 'a', 'b', false)).toBeNull();
    expect(moveId(['a', 'b'], 'a', 'a', true)).toBeNull();
  });
  it('moves up, down, first and last', () => {
    expect(shiftId(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(shiftId(['a', 'b', 'c'], 'b', 'last')).toEqual(['a', 'c', 'b']);
    expect(shiftId(['a', 'b', 'c'], 'a', 'up')).toBeNull();
    expect(shiftId(['a', 'b', 'c'], 'c', 'first')).toEqual(['c', 'a', 'b']);
  });
});

describe('paging', () => {
  it('opens on the newest page and clamps', () => {
    expect(paging(13, null)).toEqual({ index: 2, pages: 3, start: 12, end: 13 });
    expect(paging(13, 0)).toEqual({ index: 0, pages: 3, start: 0, end: 6 });
    expect(paging(5, 4)).toEqual({ index: 0, pages: 1, start: 0, end: 5 });
    expect(paging(0, null).pages).toBe(1);
  });
  it('shows gaps once there are many pages', () => {
    expect(pageNumbers(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageNumbers(5, 12)).toEqual([0, null, 4, 5, 6, null, 11]);
    expect(pageNumbers(0, 12)).toEqual([0, 1, 2, 3, null, 11]);
  });
});

describe('headlineTitle', () => {
  const c = { running: 0, queued: 0, heldBooks: 0, lanePaused: false };
  it('names what the queue is doing', () => {
    expect(headlineTitle(c)).toBe('idle');
    expect(headlineTitle({ ...c, running: 1 })).toBe('one');
    expect(headlineTitle({ ...c, running: 2 })).toBe('many');
    expect(headlineTitle({ ...c, running: 1, heldBooks: 1 })).toBe('held');
    expect(headlineTitle({ ...c, queued: 2, lanePaused: true })).toBe('held');
    expect(headlineTitle({ ...c, queued: 2 })).toBe('standby');
  });
});

describe('overridesSummary', () => {
  it('lists models, added LoRAs and unpinned ones', () => {
    const parts = overridesSummary({
      model: { '4': 'models/anime_v3.safetensors' },
      loras: [{ name: 'style/ink.safetensors', strength: 0.8 }],
      unpin: ['ink.safetensors', 'old_face.safetensors'],
    });
    expect(parts.map((p) => [p.kind, p.name])).toEqual([
      ['model', 'anime_v3'],
      ['lora', 'ink'],
      ['unpin', 'old_face'],
    ]);
    expect(parts[1].strength).toBe(0.8);
    expect(overridesSummary({ loras: [] })[0].kind).toBe('noLora');
    expect(overridesSummary({})).toEqual([]);
  });
});
