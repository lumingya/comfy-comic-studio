/**
 * Reader geometry, ported from legacy `js/reading-stage.js` (the native `mio-fit` stage).
 *
 * - `auto`: one screen per stage; two portrait pages share a stage when the stage is wide enough.
 * - `single`: one page per screen.
 * - `continuous`: no stages at all, a plain scrolling strip.
 * - `spread` (legacy 双页阅读): every two pages share a stage, whatever their shape.
 *
 * Stages only apply on a desktop-sized viewport; phones always read continuously.
 */
export type ReadingMode = 'auto' | 'single' | 'continuous';
export const READING_MODES: readonly ReadingMode[] = ['auto', 'single', 'continuous'];
export const DESKTOP_QUERY = '(min-width: 900px) and (min-height: 480px)';

export function readingMode(value: unknown): ReadingMode {
  return READING_MODES.includes(value as ReadingMode) ? (value as ReadingMode) : 'auto';
}

/**
 * Legacy 留白 阅读方式 (the 版式 drawer's choice for the native template): 自适应阅读 is the staged
 * reader with the footer's 自适应 / 单页 / 连续; 单幅完整画面 shows one picture per screen with the
 * filmstrip; 双页阅读 always pairs pages into spreads (1–2, 3–4, …).
 */
export type NativeLayout = 'webtoon' | 'gallery' | 'spread';
export const NATIVE_LAYOUTS: readonly NativeLayout[] = ['webtoon', 'gallery', 'spread'];

export function nativeLayout(value: unknown): NativeLayout {
  return NATIVE_LAYOUTS.includes(value as NativeLayout) ? (value as NativeLayout) : 'webtoon';
}

/** How the stage is cut: a reading mode, or legacy 双页阅读's fixed spreads. */
export type StageMode = ReadingMode | 'spread';

/** The stage mode a layout reads with; 自适应阅读 keeps the footer's choice. */
export function stageMode(layout: NativeLayout, mode: ReadingMode): StageMode {
  return layout === 'gallery' ? 'single' : layout === 'spread' ? 'spread' : mode;
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
  mode: StageMode,
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
    // 双页阅读 pairs every two pages (legacy readerSpreadIndices); 自适应 only two portraits.
    const pair =
      mode === 'spread'
        ? i + 1 < pages.length
        : mode === 'auto' && usable >= 760 && portrait(first) && portrait(second);
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
