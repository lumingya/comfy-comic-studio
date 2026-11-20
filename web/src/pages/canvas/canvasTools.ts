import { DEFAULT_STYLE } from './sfx';
import type { LetteringLayer, Strip } from '../../api/types';

export type CanvasSelection =
  { type: 'panel'; id: string } | { type: 'letter'; id: string; ids?: string[] } | null;
export type LetterAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export const LETTER_ALIGNMENTS: LetterAlignment[] = [
  'left',
  'center',
  'right',
  'top',
  'middle',
  'bottom',
];

export function selectedLetterIds(selection: CanvasSelection): string[] {
  return selection?.type === 'letter' ? (selection.ids ?? [selection.id]) : [];
}

export function toggleLetter(
  selection: CanvasSelection,
  id: string,
  additive: boolean,
): CanvasSelection {
  if (!additive) return { type: 'letter', id };
  const previous = selectedLetterIds(selection);
  const ids = previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id];
  return ids.length ? { type: 'letter', id: ids[0], ids } : null;
}

/** Explicit selected edits preserve all non-target layers and the rest of the strip. */
export function alignLetters(strip: Strip, ids: string[], alignment: LetterAlignment): Strip {
  const selected = strip.lettering.filter((layer) => ids.includes(layer.id));
  if (selected.length < 2) return strip;
  const left = Math.min(...selected.map((layer) => layer.box[0]));
  const top = Math.min(...selected.map((layer) => layer.box[1]));
  const right = Math.max(...selected.map((layer) => layer.box[2]));
  const bottom = Math.max(...selected.map((layer) => layer.box[3]));
  return {
    ...strip,
    lettering: strip.lettering.map((layer) => {
      if (!ids.includes(layer.id)) return layer;
      const [x0, y0, x1, y1] = layer.box;
      const dx =
        alignment === 'left'
          ? left - x0
          : alignment === 'right'
            ? right - x1
            : alignment === 'center'
              ? (left + right - x0 - x1) / 2
              : 0;
      const dy =
        alignment === 'top'
          ? top - y0
          : alignment === 'bottom'
            ? bottom - y1
            : alignment === 'middle'
              ? (top + bottom - y0 - y1) / 2
              : 0;
      return {
        ...layer,
        locked: true,
        box: [x0 + dx, y0 + dy, x1 + dx, y1 + dy],
        tail_to: layer.tail_to ? [layer.tail_to[0] + dx, layer.tail_to[1] + dy] : null,
      };
    }),
  };
}

export function syncLetterStyle(strip: Strip, ids: string[], source: LetteringLayer): Strip {
  return {
    ...strip,
    lettering: strip.lettering.map((layer) =>
      !ids.includes(layer.id) || layer.id === source.id
        ? layer
        : {
            ...layer,
            font_size: source.font_size,
            vertical: source.vertical,
            style: source.style ? { ...source.style } : null,
            locked: true,
          },
    ),
  };
}

export function newLayer(strip: Strip, kind: 'caption' | 'sfx'): LetteringLayer {
  const y = Math.max(40, Math.round(strip.height / 2));
  const sfx = kind === 'sfx';
  return {
    id: `letter_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
    panel_id: null,
    kind,
    text: sfx ? '砰！' : '…',
    speaker_id: null,
    box: sfx ? [300, y, 500, y + 90] : [40, y, 320, y + 70],
    tail_to: null,
    vertical: false,
    font_size: null,
    locked: true,
    bridge_to: null,
    style: sfx ? DEFAULT_STYLE : null,
  };
}
