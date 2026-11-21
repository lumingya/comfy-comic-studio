import { useRef, useState } from 'react';
import type { AppSettings, ImageChannel } from '../../api/types';

type FieldIntent = {
  path: string[];
  before: unknown;
  value: unknown;
  version: number;
  revision?: string;
};
type Intent = Record<string, FieldIntent>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const masked = (value: unknown): boolean =>
  value === '••••••' ||
  (value !== null && typeof value === 'object' && Object.values(value).some(masked));

function read(settings: AppSettings, path: string[]): unknown {
  if (path[0] === 'image_channels') {
    const channel = settings.image_channels?.find((c) => c.id === path[1]);
    return path.length === 2
      ? (channel ?? null)
      : (channel?.[path[2] as keyof ImageChannel] ?? null);
  }
  if (path[0] === 'llm') return settings.llm[path[1] as keyof AppSettings['llm']];
  return settings[path[0] as keyof AppSettings] ?? null;
}

function assign(target: Record<string, unknown>, path: string[], value: unknown) {
  if (path.length === 1) target[path[0]] = value;
  else {
    const nested = (target[path[0]] ??= {}) as Record<string, unknown>;
    nested[path[1]] = value;
  }
}

export function settingsIntentBody(intent: Intent): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  const channels = new Map<string, { id: string; before: unknown; after: unknown }>();
  for (const { path, before, value, revision } of Object.values(intent)) {
    // Different secret baselines cannot be proven by one token. Force a conflict rather
    // than silently substituting a freshly refetched revision for an older secret edit.
    if (masked(before)) {
      const token = revision ?? '';
      body.expected_revision =
        body.expected_revision === undefined || body.expected_revision === token ? token : '';
    }
    const field = path.at(-1)!;
    const after =
      typeof value === 'string' && ['base_url', 'model', 'size', 'quality'].includes(field)
        ? value.trim()
        : value;
    if (path[0] !== 'image_channels') {
      assign(body, path, after);
      assign(expected, path, before);
    } else if (path.length === 2) {
      const row = after === null ? null : { ...(after as ImageChannel) };
      if (row)
        for (const field of ['base_url', 'model', 'size', 'quality'] as const)
          row[field] = row[field].trim();
      channels.set(path[1], { id: path[1], before, after: row });
    } else {
      const edit = channels.get(path[1]) ?? { id: path[1], before: {}, after: {} };
      (edit.before as Record<string, unknown>)[field] = before;
      (edit.after as Record<string, unknown>)[field] = after;
      channels.set(path[1], edit);
    }
  }
  if (Object.keys(expected).length) body.expected = expected;
  if (channels.size) body.image_channel_edits = [...channels.values()];
  return body;
}

/** Store only field intentions; background refreshes remain the source for untouched values. */
export function useSettingsDraft(settings: AppSettings | undefined, pending: boolean) {
  const [intent, setIntent] = useState<Intent>({});
  const version = useRef(0);
  const view = settings ? structuredClone(settings) : undefined;
  if (view) {
    for (const { path, value } of Object.values(intent)) {
      if (path[0] !== 'image_channels')
        assign(view as unknown as Record<string, unknown>, path, value);
      else {
        const list = (view.image_channels ??= []);
        const index = list.findIndex((c) => c.id === path[1]);
        if (path.length === 2) {
          if (value === null) {
            if (index >= 0) list.splice(index, 1);
          } else if (index >= 0) list[index] = structuredClone(value as ImageChannel);
          else list.push(structuredClone(value as ImageChannel));
        } else if (index >= 0) Object.assign(list[index], { [path[2]]: value });
      }
    }
  }
  const change = (path: string[], value: unknown) => {
    if (!settings) return;
    const nextVersion = ++version.current;
    setIntent((current) => {
      const next = { ...current };
      // While a newly created row is pending, all its fields share the create intention.
      const rowKey = JSON.stringify(path.slice(0, 2));
      if (path[0] === 'image_channels' && path.length === 3 && next[rowKey]) {
        const row = next[rowKey];
        next[rowKey] = {
          ...row,
          value: { ...(row.value as object), [path[2]]: value },
          version: nextVersion,
        };
        return next;
      }
      const key = JSON.stringify(path);
      const previous = next[key];
      const before = previous ? previous.before : read(settings, path);
      if (path[0] === 'image_channels' && path.length === 2) {
        for (const [key, entry] of Object.entries(next))
          if (entry.path[0] === 'image_channels' && entry.path[1] === path[1]) delete next[key];
      }
      if (same(before, value) && !pending) delete next[key];
      else
        next[key] = {
          path,
          before,
          value,
          version: nextVersion,
          revision: previous ? previous.revision : settings.write_revision,
        };
      return next;
    });
  };
  return {
    view,
    intent,
    change,
    dirty: Object.keys(intent).length > 0,
    reset: () => setIntent({}),
    saved: (submitted: Intent, result: AppSettings) =>
      setIntent((current) => {
        const next = { ...current };
        for (const [key, saved] of Object.entries(submitted)) {
          const active = next[key];
          if (!active) continue;
          const before = read(result, active.path);
          if (active.version === saved.version || same(active.value, before)) delete next[key];
          else if (
            active.path[0] === 'image_channels' &&
            active.path.length === 2 &&
            active.before === null &&
            before !== null
          ) {
            if (active.value === null) {
              next[key] = { ...active, before, revision: result.write_revision };
              continue;
            }
            // A new row was edited again while creation was in flight. Rebase as field edits.
            delete next[key];
            for (const field of Object.keys(active.value as ImageChannel)) {
              const value = (active.value as Record<string, unknown>)[field];
              const path = [...active.path, field];
              const old = read(result, path);
              if (
                field !== 'id' &&
                !same(value, (saved.value as Record<string, unknown>)[field]) &&
                !same(value, old)
              )
                next[JSON.stringify(path)] = {
                  path,
                  before: old,
                  value,
                  version: active.version,
                  revision: result.write_revision,
                };
            }
          } else next[key] = { ...active, before, revision: result.write_revision };
        }
        return next;
      }),
  };
}
