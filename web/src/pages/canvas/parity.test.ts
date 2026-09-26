/**
 * The canvas mirrors must match the server renderer: `parity.json` is generated from the
 * Python modules (`server/tests/test_web_parity.py --write`) and checked on both sides.
 */
import { describe, expect, it } from 'vitest';
import { parseStops, sample, trackBands, colorAt, validSpec, type RGB } from './backdrop';
import parity from './parity.json';
import { glyphLayout } from './sfx';
import { blockSize, cellCenters, columns, glyphs } from './vertical';

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0; // + 0 folds -0 into 0

describe('vertical text', () => {
  it.each(parity.vertical.map((c) => [`${c.text} / ${c.max}`, c] as const))('%s', (_, c) => {
    expect(glyphs(c.text)).toEqual(c.glyphs);
    const cols = columns(c.text, c.max);
    expect(cols).toEqual(c.columns);
    expect(blockSize(cols, 30, 6)).toEqual(c.block);
    const cells = cellCenters(cols, [200, 100], 30, 6).map((g) => [g.ch, r4(g.x), r4(g.y)]);
    expect(cells).toEqual(c.cells);
  });
});

describe('SFX glyph layout', () => {
  it.each(parity.sfx.map((c) => [`${c.text} ${c.effect} ${c.vertical}`, c] as const))(
    '%s',
    (_, c) => {
      const out = glyphLayout(
        c.text,
        48,
        { effect: c.effect as 'none', letter_spacing: 4 },
        c.vertical,
      );
      expect(out.map((g) => ({ ...g, x: r4(g.x), y: r4(g.y), angle: r4(g.angle) }))).toEqual(
        c.glyphs.map((g) => ({ ...g, x: r4(g.x), y: r4(g.y), angle: r4(g.angle) })),
      );
    },
  );
});

describe('transition backgrounds', () => {
  it('validates specs like the server', () => {
    for (const s of parity.specs) expect([s.spec, validSpec(s.spec)]).toEqual([s.spec, s.valid]);
  });

  it('samples gradients like the server', () => {
    for (const s of parity.samples) expect(sample(s.stops as RGB[], s.t)).toEqual(s.rgb);
  });

  it('paints the track in the same colours (±3 per channel)', () => {
    const { track } = parity;
    const boxes = Object.fromEntries(track.panels.map((p) => [p.id, p.box]));
    const bands = trackBands(track.panels, boxes, track.background, track.height);
    track.rows.forEach((y, i) => {
      const got = colorAt(bands, y, track.background);
      got.forEach((v, k) => expect(Math.abs(v - track.colors[i][k])).toBeLessThanOrEqual(3));
    });
    expect(parseStops('#000>#fff')).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });
});
