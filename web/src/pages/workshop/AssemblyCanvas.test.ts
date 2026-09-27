import { describe, expect, it } from 'vitest';
import { canvasTasks, type CanvasDesign } from './AssemblyCanvas';

const msgs = { empty: 'empty', unlinked: 'link {{title}}' };
const node = { x: 0, y: 0 };

describe('canvasTasks', () => {
  it('makes one task per storyboard, merging linked presets in card order', () => {
    const d: CanvasDesign = {
      stories: [
        { id: 's1', storyId: 'sb_a', title: ' A · 新画册 ', ...node },
        { id: 's2', storyId: 'sb_a', title: 'B', ...node },
      ],
      presets: [
        { id: 'p1', presetId: 'pre_1', ...node },
        { id: 'p2', presetId: 'pre_2', ...node },
      ],
      edges: [
        { story: 's1', preset: 'p2' },
        { story: 's1', preset: 'p1' },
        { story: 's2', preset: 'p2' },
      ],
    };
    expect(canvasTasks(d, msgs)).toEqual([
      { storyboard_id: 'sb_a', preset_ids: ['pre_1', 'pre_2'], title: 'A · 新画册' },
      { storyboard_id: 'sb_a', preset_ids: ['pre_2'], title: 'B' },
    ]);
  });

  it('rejects an empty board and unlinked or unnamed nodes', () => {
    expect(() => canvasTasks({ stories: [], presets: [], edges: [] }, msgs)).toThrow('empty');
    const d: CanvasDesign = {
      stories: [{ id: 's1', storyId: 'sb', title: 'Lonely', ...node }],
      presets: [{ id: 'p1', presetId: 'pre', ...node }],
      edges: [],
    };
    expect(() => canvasTasks(d, msgs)).toThrow('link Lonely');
    const unnamed = {
      ...d,
      stories: [{ ...d.stories[0], title: ' ' }],
      edges: [{ story: 's1', preset: 'p1' }],
    };
    expect(() => canvasTasks(unnamed, msgs)).toThrow('link');
  });
});
