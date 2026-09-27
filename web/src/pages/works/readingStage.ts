/**
 * Reader geometry, ported from legacy `js/reading-stage.js` (the native `mio-fit` stage).
 *
 * - `auto`: one screen per stage; two portrait pages share a stage when the stage is wide enough.
 * - `single`: one page per screen.
 * - `continuous`: no stages at all, a plain scrolling strip.
 *
 * Stages only apply on a desktop-sized viewport; phones always read continuously.
 */
export type ReadingMode = 'auto' | 'single' | 'continuous';
export const READING_MODES: readonly ReadingMode[] = ['auto', 'single', 'continuous'];
export const DESKTOP_QUERY = '(min-width: 900px) and (min-height: 480px)';

export function readingMode(value: unknown): ReadingMode {
  return READING_MODES.includes(value as ReadingMode) ? (value as ReadingMode) : 'auto';
}

export interface StagePage {
  id: string;
  caption: boolean;
}
export interface Size {
  w: number;
  h: number;
}
export interface StageItem {
  index: number;
  w: number;
  h: number;
}
export interface Stage {
  /** Index of the first page in this stage. */
  start: number;
  items: StageItem[];
}

const PAD = 16;
/** The native reader's stage has 16px bottom padding (offline HTML uses 64px for its controls). */
const BOTTOM = 16;
const SPACE = 16;
const CAPTION = 80;

/** Groups pages into one-screen stages and fits every image inside its share of the screen. */
export function buildStages(
  pages: readonly StagePage[],
  sizes: Readonly<Record<string, Size | undefined>>,
  mode: ReadingMode,
  view: Size,
): Stage[] {
  const { w: W, h: H } = view;
  const usable = W - PAD * 2;
  const portrait = (d?: Size) =>
    !!d && d.w > 0 && d.h > 0 && d.w / d.h <= 0.88 && Math.min(d.h, H - PAD - BOTTOM) >= H * 0.5;
  const stages: Stage[] = [];
  for (let i = 0; i < pages.length;) {
    const first = sizes[pages[i].id];
    const second = pages[i + 1] ? sizes[pages[i + 1].id] : undefined;
    const pair = mode === 'auto' && usable >= 760 && portrait(first) && portrait(second);
    const count = pair ? 2 : 1;
    const stage: Stage = { start: i, items: [] };
    for (let j = 0; j < count; j++, i++) {
      const d = sizes[pages[i].id];
      const maxH = Math.max(100, H - PAD - BOTTOM - (pages[i].caption ? CAPTION : 0));
      const maxW = (usable - SPACE * (count - 1)) / count;
      const scale = d && d.w && d.h ? Math.min(1, maxW / d.w, maxH / d.h) : 1;
      stage.items.push({
        index: i,
        w: d && d.w ? d.w * scale : maxW,
        h: d && d.h ? d.h * scale : maxH,
      });
    }
    stages.push(stage);
  }
  return stages;
}

/** The stage that shows page `index`. */
export function stageOf(stages: readonly Stage[], index: number): number {
  const at = stages.findIndex((s) => index >= s.start && index < s.start + s.items.length);
  return at < 0 ? 0 : at;
}
