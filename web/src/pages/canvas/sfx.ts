/**
 * SFX (拟声字) glyph maths — mirror of `glyph_layout` in
 * `server/mio_server/pipeline/lettering.py`, so the canvas matches the export.
 */
import type { LetterStyle } from '../../api/types';

export interface Glyph {
  ch: string;
  size: number;
  x: number;
  y: number;
  angle: number;
}

export const DEFAULT_STYLE: LetterStyle = {
  fill: '#e03131',
  stroke: '#ffffff',
  stroke_width: 6,
  rotation: -8,
  effect: 'grow',
  letter_spacing: 0,
  preset: 'impact',
};

export const EFFECTS: LetterStyle['effect'][] = ['none', 'grow', 'shake', 'arc'];

/** Approximate advance: CJK glyphs are square, Latin ones about 0.6 em. */
export function advance(ch: string, size: number): number {
  return /[\u0000-\u024f]/.test(ch) ? size * 0.6 : size;
}

/** Per-glyph centres around (0, 0) and angles in degrees (clockwise). */
export function glyphLayout(
  text: string,
  size: number,
  style: Pick<LetterStyle, 'effect' | 'letter_spacing'>,
  vertical: boolean,
  measure: (ch: string, size: number) => number = advance,
): Glyph[] {
  const chars = Array.from(text).filter((c) => !/\s/.test(c));
  const n = chars.length;
  const out: Glyph[] = [];
  let pos = 0;
  chars.forEach((ch, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    let scale = 1;
    let angle = 0;
    let off = 0;
    if (style.effect === 'grow') scale = 0.7 + 0.6 * t;
    else if (style.effect === 'shake') {
      const sign = i % 2 ? 1 : -1;
      angle = 12 * sign;
      off = 0.12 * size * sign;
    } else if (style.effect === 'arc') {
      const u = 2 * t - 1;
      off = -0.45 * size * (1 - u * u);
      angle = 18 * u;
    }
    const s = Math.max(6, Math.round(size * scale));
    const step = vertical ? s * 1.02 : measure(ch, s);
    const centre = pos + step / 2;
    out.push({ ch, size: s, x: vertical ? off : centre, y: vertical ? centre : off, angle });
    pos += step + style.letter_spacing;
  });
  const total = n ? pos - style.letter_spacing : 0;
  for (const g of out) {
    if (vertical) g.y -= total / 2;
    else g.x -= total / 2;
  }
  return out;
}

/** Unrotated bounding half-extents of a glyph run (for hit boxes). */
export function extent(glyphs: Glyph[], stroke: number): [number, number] {
  let w = 0;
  let h = 0;
  for (const g of glyphs) {
    w = Math.max(w, Math.abs(g.x) + g.size * 0.6 + stroke);
    h = Math.max(h, Math.abs(g.y) + g.size * 0.6 + stroke);
  }
  return [w, h];
}
