import { describe, expect, it } from 'vitest';
import { episode } from '../../test/fixtures';
import type { Strip } from '../../api/types';
import {
  alignLetters,
  LETTER_ALIGNMENTS,
  selectedLetterIds,
  syncLetterStyle,
  toggleLetter,
} from './canvasTools';

function canvas(): Strip {
  const source = {
    ...episode.strip.lettering[0],
    box: [100, 100, 300, 180],
    tail_to: [180, 220],
    font_size: 24,
    vertical: true,
  };
  return {
    ...structuredClone(episode.strip),
    lettering: [
      source,
      {
        ...source,
        id: 'second',
        text: 'Other',
        kind: 'caption',
        box: [400, 300, 500, 400],
        tail_to: null,
        font_size: 40,
      },
      { ...source, id: 'untouched', text: 'Keep', box: [20, 600, 200, 700] },
    ],
  } as Strip;
}

describe('explicit lettering tools', () => {
  it('extends and toggles multi-selection without losing the first style source', () => {
    const first = toggleLetter(null, 'a', false);
    const both = toggleLetter(first, 'b', true);
    expect(both).toEqual({ type: 'letter', id: 'a', ids: ['a', 'b'] });
    expect(selectedLetterIds(toggleLetter(both, 'a', true))).toEqual(['b']);
    expect(toggleLetter(first, 'a', true)).toBeNull();
    expect(selectedLetterIds(toggleLetter(both, 'c', false))).toEqual(['c']);
  });

  it.each(LETTER_ALIGNMENTS)(
    'aligns %s as one targeted change and translates tails with their layers',
    (alignment) => {
      const strip = canvas();
      const before = structuredClone(strip);
      const output = alignLetters(strip, ['letter_1', 'second'], alignment);
      const [a, b] = output.lettering;
      const axis = { left: 0, right: 2, top: 1, bottom: 3 }[alignment as 'left'];
      if (axis !== undefined) expect(a.box[axis]).toBe(b.box[axis]);
      else {
        const i = alignment === 'center' ? 0 : 1;
        expect(a.box[i] + a.box[i + 2]).toBe(b.box[i] + b.box[i + 2]);
      }
      expect(a.tail_to![0] - a.box[0]).toBe(80);
      expect(a.tail_to![1] - a.box[1]).toBe(120);
      expect(output.lettering[2]).toBe(strip.lettering[2]);
      expect(output.panel_boxes).toBe(strip.panel_boxes);
      expect(output.crops).toBe(strip.crops);
      expect(strip).toEqual(before);
    },
  );

  it('copies style only, keeping text, identity, geometry, kind and non-target layers', () => {
    const strip = canvas();
    const source = strip.lettering[0];
    const output = syncLetterStyle(strip, ['letter_1', 'second'], source);
    expect(output.lettering[1]).toEqual({
      ...strip.lettering[1],
      font_size: 24,
      vertical: true,
      style: source.style,
      locked: true,
    });
    expect(output.lettering[0]).toBe(source);
    expect(output.lettering[2]).toBe(strip.lettering[2]);
  });
});
