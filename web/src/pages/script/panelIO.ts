import type { Panel } from '../../api/types';

export const PANEL_FORMAT = 'mio.panels/1';

export interface PanelBundle {
  format: typeof PANEL_FORMAT;
  panels: Panel[];
}

/** Panels as a portable JSON document (ids are dropped by the importer). */
export function bundlePanels(panels: Panel[]): PanelBundle {
  return { format: PANEL_FORMAT, panels: panels.map((p) => ({ ...p })) };
}

export class PanelImportError extends Error {}

/** Accepts our bundle, a bare panel array, or a single panel object. */
export function parsePanelBundle(text: string): Panel[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PanelImportError('json');
  }
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as PanelBundle).panels)
      ? (value as PanelBundle).panels
      : value && typeof value === 'object' && 'description' in (value as object)
        ? [value]
        : null;
  if (!list || !list.length) throw new PanelImportError('empty');
  for (const p of list) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new PanelImportError('shape');
  }
  return list as Panel[];
}

export function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
