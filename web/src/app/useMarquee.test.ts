import { describe, expect, it } from 'vitest';
import { marqueeIds } from './useMarquee';
const items = [
  { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 100 } },
  { id: 'b', rect: { left: 120, right: 220, top: 0, bottom: 100 } },
  { id: 'c', rect: { left: 240, right: 340, top: 0, bottom: 100 } },
];
const rect = { left: 90, right: 130, top: 10, bottom: 70 };
describe('marquee selection geometry', () => {
  it('selects touched cards rather than requiring complete containment', () => {
    expect(marqueeIds(items, rect, ['c'], 'replace')).toEqual(['a', 'b']);
    expect(
      marqueeIds(items, { left: 100, right: 120, top: 0, bottom: 100 }, [], 'replace'),
    ).toEqual([]);
  });
  it('Shift adds while Ctrl/Command toggles against the drag-start snapshot', () => {
    expect(marqueeIds(items, rect, ['a', 'c'], 'add')).toEqual(['a', 'c', 'b']);
    expect(marqueeIds(items, rect, ['a', 'c'], 'toggle')).toEqual(['c', 'b']);
    expect(marqueeIds(items, rect, ['a', 'c'], 'toggle')).toEqual(['c', 'b']);
  });
});
