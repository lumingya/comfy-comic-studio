import { describe, expect, it } from 'vitest';
import { cropFor, framingFor, type Box } from './crop';

describe('image framing', () => {
  it.each([
    [1600, 900, 800, 1200],
    [600, 1800, 800, 400],
    [832, 1109, 800, 1067],
  ])('preserves artwork proportions for source %i × %i in frame %i × %i', (w, h, bw, bh) => {
    const size = { width: w, height: h };
    const box: Box = [10, 100, 10 + bw, 100 + bh];
    for (const zoom of [1, 2, 8])
      for (const x of [0, 0.5, 1]) {
        const crop = cropFor(size, box, { zoom, x, y: 1 - x });
        expect(crop.every((v) => v >= 0 && v <= 1)).toBe(true);
        expect(((crop[2] - crop[0]) * w) / ((crop[3] - crop[1]) * h)).toBeCloseTo(bw / bh);
        expect(framingFor(size, box, crop).zoom).toBeCloseTo(zoom);
      }
  });
  it('can reframe after resizing while keeping zoom and the chosen edge', () => {
    const size = { width: 1200, height: 800 };
    const crop = cropFor(size, [0, 0, 400, 400], { zoom: 2, x: 1, y: 0 });
    const next = cropFor(size, [0, 0, 800, 400], framingFor(size, [0, 0, 400, 400], crop));
    expect(next[2]).toBeCloseTo(1);
    expect(next[1]).toBe(0);
    expect(((next[2] - next[0]) * 1200) / ((next[3] - next[1]) * 800)).toBeCloseTo(2);
  });
});
