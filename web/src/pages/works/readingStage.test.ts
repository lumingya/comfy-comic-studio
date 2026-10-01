import { describe, expect, it } from 'vitest';
import { buildStages, nativeLayout, readingMode, stageMode, stageOf } from './readingStage';

const pages = ['a', 'b', 'c'].map((id) => ({ id, caption: false }));
const portrait = { w: 800, h: 1200 };
const wide = { w: 1600, h: 900 };
const view = { w: 1400, h: 900 };

describe('reading stage', () => {
  it('pairs portrait pages in auto mode on a wide stage', () => {
    const stages = buildStages(pages, { a: portrait, b: portrait, c: portrait }, 'auto', view);
    expect(stages.map((s) => s.items.length)).toEqual([2, 1]);
    expect(stageOf(stages, 1)).toBe(0);
    expect(stageOf(stages, 2)).toBe(1);
    // Both pages fit side by side inside the usable width.
    const [x, y] = stages[0].items;
    expect(x.w + y.w + 16).toBeLessThanOrEqual(view.w - 32 + 0.001);
  });

  it('shows one page per screen in single mode', () => {
    const stages = buildStages(pages, { a: portrait, b: portrait, c: portrait }, 'single', view);
    expect(stages.map((s) => s.items.length)).toEqual([1, 1, 1]);
  });

  it('does not pair wide pages or narrow stages', () => {
    expect(buildStages(pages, { a: wide, b: wide }, 'auto', view).length).toBe(3);
    const narrow = { w: 700, h: 900 };
    expect(buildStages(pages, { a: portrait, b: portrait }, 'auto', narrow).length).toBe(3);
  });

  it('fits a page into one screen and never upscales', () => {
    const [s] = buildStages([pages[0]], { a: { w: 1000, h: 4000 } }, 'single', view);
    expect(s.items[0].h).toBeCloseTo(900 - 32);
    const [small] = buildStages([pages[0]], { a: { w: 200, h: 300 } }, 'single', view);
    expect(small.items[0]).toMatchObject({ w: 200, h: 300 });
  });

  it('pairs every two pages in 双页阅读, whatever their shape or the stage width', () => {
    const four = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, caption: false }));
    const sizes = { a: wide, b: portrait, c: wide, d: wide, e: portrait };
    const stages = buildStages(four, sizes, 'spread', { w: 700, h: 900 });
    expect(stages.map((s) => [s.start, s.items.length])).toEqual([
      [0, 2],
      [2, 2],
      [4, 1],
    ]);
    const [x, y] = stages[0].items;
    expect(x.w + y.w + 16).toBeLessThanOrEqual(700 - 32 + 0.001);
  });

  it('maps the legacy 阅读方式 onto stage modes', () => {
    expect(stageMode('webtoon', 'continuous')).toBe('continuous');
    expect(stageMode('gallery', 'auto')).toBe('single');
    expect(stageMode('spread', 'continuous')).toBe('spread');
    expect(nativeLayout('spread')).toBe('spread');
    expect(nativeLayout('auto')).toBe('webtoon');
  });

  it('sanitises stored modes', () => {
    expect(readingMode('continuous')).toBe('continuous');
    expect(readingMode('spread')).toBe('auto');
    expect(readingMode(null)).toBe('auto');
  });
});
