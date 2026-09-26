/**
 * Background track — mirror of `server/mio_server/pipeline/backdrop.py`.
 * A panel's `transition_background` colours the gap after it (`transparent`, `#rgb`,
 * `#a>#b>#c`); behind each panel the track blends from the previous gap's last colour to the
 * next gap's first colour.
 */

export type RGB = [number, number, number];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseColor(value: string): RGB | null {
  let v = value.trim();
  if (!HEX.test(v)) return null;
  if (v.length === 4) v = `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
}

/** `null` = transparent (or invalid). */
export function parseStops(spec: string | null | undefined): RGB[] | null {
  if (!spec || spec.trim() === '' || spec.trim() === 'transparent') return null;
  const stops = spec.split('>').map(parseColor);
  return stops.every(Boolean) ? (stops as RGB[]) : null;
}

export function validSpec(spec: string): boolean {
  const s = spec.trim();
  return s === '' || s === 'transparent' || parseStops(s) !== null;
}

export const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

export function sample(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)) as RGB;
}

export function isDark(c: RGB): boolean {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] <= 140;
}

export interface Band {
  y0: number;
  y1: number;
  stops: RGB[];
}

/** Coloured bands (behind panels and in gaps) in strip coordinates; `panels` in reading order. */
export function trackBands(
  panels: { id: string; transition_background: string }[],
  boxes: Record<string, number[]>,
  background: string,
  height: number,
): Band[] {
  const base = parseColor(background) ?? [255, 255, 255];
  const same = (a: RGB, b: RGB) => a.every((v, k) => v === b[k]);
  const present = panels.filter((p) => boxes[p.id]);
  const bands: Band[] = [];
  let before: RGB = base;
  present.forEach((panel, i) => {
    const [, y0, , y1] = boxes[panel.id];
    const stops = parseStops(panel.transition_background);
    const gapTop = stops ? stops[0] : base;
    if (!same(before, base) || !same(gapTop, base)) bands.push({ y0, y1, stops: [before, gapTop] });
    const end = i + 1 === present.length ? height : boxes[present[i + 1].id][1];
    if (stops && end > y1) bands.push({ y0: y1, y1: end, stops });
    before = stops ? stops[stops.length - 1] : base;
  });
  return bands;
}

/** Konva `fillLinearGradientColorStops` for evenly spaced stops. */
export function konvaStops(stops: RGB[]): (number | string)[] {
  if (stops.length === 1) return [0, css(stops[0]), 1, css(stops[0])];
  return stops.flatMap((c, i) => [i / (stops.length - 1), css(c)]);
}

/** Track colour at strip row `y` (for frameless fades on the canvas). */
export function colorAt(bands: Band[], y: number, background: string): RGB {
  const band = bands.find((b) => y >= b.y0 && y <= b.y1);
  if (!band) return parseColor(background) ?? [255, 255, 255];
  return sample(band.stops, (y - band.y0) / Math.max(1, band.y1 - band.y0));
}
