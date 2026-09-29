import type { Episode, Panel } from '../../api/types';
import { localId, type Preset } from '../../api/workshop';
import { bindingProblem, normalizeBinding } from './presetBindings';

/** Save `value` as a pretty-printed JSON download. */
export function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Let the user pick one or more `.json` files; resolves to their documents (lists flattened). */
export function pickJsonFiles(): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.multiple = true;
    input.onchange = async () => {
      try {
        const files = [...(input.files ?? [])];
        const docs = await Promise.all(
          files.map(async (f) => JSON.parse(await f.text()) as unknown),
        );
        // A multi-export is one file holding a list of documents.
        resolve(docs.flatMap((d) => (Array.isArray(d) ? (d as unknown[]) : [d])));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    input.click();
  });
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export interface BoardFile {
  title: string;
  synopsis: string;
  /** 起手模板: legacy `basePrompt`, `base_prompt` in our own files. */
  base_prompt: string;
  panels: Obj[];
}

/** A legacy frame (`mio.resource.v2` storyboard) → panel fields in raw mode. */
export function frameToPanel(f: Obj): Obj {
  const width = int(f.width);
  const height = int(f.height);
  const seed = int(f.seed);
  const values: Obj = {};
  if (int(f.steps) != null && f.steps !== 24) values.steps = f.steps;
  if (typeof f.cfg === 'number' && f.cfg !== 7) values.cfg = f.cfg;
  const caption = str(f.caption).trim();
  return {
    description: str(f.name),
    dialogues: caption ? [{ text: caption, kind: 'narration' }] : [],
    overrides: {
      raw_prompt: str(f.prompt),
      raw_negative: str(f.negative) || null,
      seed: seed != null && seed >= 0 ? seed : null,
      width: width && width >= 64 && width <= 4096 ? width : null,
      height: height && height >= 64 && height <= 4096 ? height : null,
      values,
    },
  };
}

export function storyboardFromFile(raw: unknown): BoardFile {
  const d = (raw ?? {}) as Obj;
  if (Array.isArray(d.frames))
    return {
      title: str(d.title) || '导入的分镜',
      synopsis: str(d.outline),
      base_prompt: str(d.basePrompt),
      panels: (d.frames as Obj[]).filter((f) => f && typeof f === 'object').map(frameToPanel),
    };
  if (Array.isArray(d.panels))
    return {
      title: str(d.title) || '导入的分镜',
      synopsis: str(d.synopsis),
      base_prompt: str(d.base_prompt),
      panels: d.panels as Obj[],
    };
  throw new Error('不是分镜文件：缺少 frames / panels');
}

export function storyboardToFile(ep: Episode) {
  const panels = [...ep.panels]
    .sort((a, b) => a.order - b.order)
    .map((p: Panel) => {
      const { id: _id, order: _order, ...rest } = p;
      return rest;
    });
  return {
    schema: 'mio.storyboard.v1',
    title: ep.title,
    synopsis: ep.synopsis,
    base_prompt: ep.base_prompt ?? '',
    panels,
  };
}

export function presetFromFile(raw: unknown): Preset {
  const d = (raw ?? {}) as Obj;
  if (Array.isArray(d.entries) && Array.isArray(d.groups))
    return {
      ...(d as unknown as Preset),
      bindings: Array.isArray(d.bindings) ? (d.bindings as Preset['bindings']) : [],
      id: localId('preset'),
    };
  if (Array.isArray(d.entries)) {
    const groups = ((d.settingsGroups as Obj[]) ?? [])
      .filter((g) => g && g.id)
      .map((g) => ({ id: str(g.id), title: str(g.title) || str(g.id) }));
    const known = new Set(groups.map((g) => g.id));
    return {
      id: localId('preset'),
      title: str(d.title) || '导入的预设',
      groups,
      entries: (d.entries as Obj[])
        .filter((e) => e && e.key && (e.type ?? 'text') === 'text')
        .map((e) => ({
          id: localId('var'),
          key: str(e.key),
          value: str(e.value),
          label: '',
          hint: '',
          group_id: known.has(str(e.groupId)) ? str(e.groupId) : null,
        })),
      bindings: legacyBindings(d.bindings),
    };
  }
  throw new Error('不是预设文件：缺少 entries');
}

/** Legacy preset `bindings` (nodeId/path/source/type/value/enabled); other sources are dropped. */
function legacyBindings(raw: unknown): Preset['bindings'] {
  const out: Preset['bindings'] = [];
  for (const b of Array.isArray(raw) ? (raw as Obj[]) : []) {
    const source = str(b?.source) || 'literal';
    if (source !== 'literal' && source !== 'variable') continue;
    const type = (['text', 'number', 'boolean', 'json', 'auto'] as const).find(
      (k) => k === (str(b.type) || 'auto'),
    );
    const binding = normalizeBinding({
      node_id: str(b.nodeId),
      path: str(b.path),
      source,
      type: type ?? 'auto',
      value: str(b.value),
      enabled: b.enabled !== false,
    });
    if (!binding.node_id || !binding.path) continue;
    // The legacy app never applied a second enabled binding of one input either.
    if (bindingProblem(binding, out) === 'duplicate') binding.enabled = false;
    out.push(binding);
  }
  return out;
}

export function presetToFile(p: Preset) {
  return { schema: 'mio.preset.v1', ...p };
}
