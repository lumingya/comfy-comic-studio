import type { Preset } from '../../api/workshop';

/** 预设「LoRA / 节点输入绑定」 (server models.PresetBinding). */
export type Binding = Preset['bindings'][number];
export type BindingType = Binding['type'];

export const BINDING_TYPES: BindingType[] = ['text', 'number', 'boolean', 'json', 'auto'];

export const blankBinding = (): Binding => ({
  node_id: '',
  path: 'lora_name',
  source: 'literal',
  type: 'text',
  value: '',
  enabled: true,
});

const trimPath = (path: string) => path.trim().replace(/^\/+|\/+$/g, '');

/** What the server stores: trimmed ids and paths, a variable named without braces. */
export function normalizeBinding(b: Binding): Binding {
  return {
    ...b,
    node_id: b.node_id.trim(),
    path: trimPath(b.path),
    value:
      b.source === 'variable'
        ? b.value
            .trim()
            .replace(/^\{+|\}+$/g, '')
            .trim()
        : b.value,
  };
}

const TRUE = ['true', '1', 'yes', 'on'];
const FALSE = ['false', '0', 'no', 'off'];

export type BindingProblem =
  'target' | 'node' | 'wildcard' | 'variable' | 'number' | 'boolean' | 'json' | 'duplicate';

/** The server's checks, so the dialog can say what is wrong before saving. */
export function bindingProblem(raw: Binding, others: Binding[]): BindingProblem | null {
  const b = normalizeBinding(raw);
  if (!b.node_id || !b.path) return 'target';
  if (/[\s/]/.test(b.node_id)) return 'node';
  if (b.path.includes('*')) return 'wildcard';
  if (b.source === 'variable' && !b.value) return 'variable';
  // A literal with {变量} is typed when the album renders; JSON (which has braces) is checked now.
  if (b.source === 'literal' && (b.type === 'json' || !b.value.includes('{'))) {
    const text = b.value.trim();
    if (b.type === 'number' && (!text || !Number.isFinite(Number(text)))) return 'number';
    if (b.type === 'boolean' && ![...TRUE, ...FALSE].includes(text.toLowerCase())) return 'boolean';
    if (b.type === 'json') {
      try {
        JSON.parse(text);
      } catch {
        return 'json';
      }
    }
  }
  if (
    b.enabled &&
    others.some((o) => o.enabled && o.node_id.trim() === b.node_id && trimPath(o.path) === b.path)
  )
    return 'duplicate';
  return null;
}

/** Enabled bindings that some other preset also sets (the later preset in an assembly wins). */
export function sharedTargets(preset: Preset, all: Preset[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of preset.bindings) {
    if (!b.enabled) continue;
    const key = `${b.node_id}/${b.path}`;
    const titles = all
      .filter(
        (p) =>
          p.id !== preset.id &&
          p.bindings.some((o) => o.enabled && `${o.node_id}/${o.path}` === key),
      )
      .map((p) => p.title);
    if (titles.length) out.set(key, titles);
  }
  return out;
}
