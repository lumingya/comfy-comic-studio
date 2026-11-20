import { useMemo } from 'react';
import type { Panel, Series } from '../../api/types';
import { captionText } from './caption';
import type { KnownVariables, PromptSources } from './PromptSurface';
/** Every variable some preset defines (true when at least one gives it a value). */
export function useKnownVariables(source: Series): KnownVariables {
  return useMemo(() => {
    const known: KnownVariables = new Map();
    for (const p of source.presets)
      for (const e of p.entries) known.set(e.key, known.get(e.key) || !!e.value.trim());
    for (const [k, v] of Object.entries(source.variables)) known.set(k, known.get(k) || !!v.trim());
    return known;
  }, [source]);
}

/** Variable name → the presets defining it (title + value), in library order, for completion. */
export function usePromptSources(source: Series): PromptSources {
  return useMemo(() => {
    const sources: PromptSources = new Map();
    for (const p of source.presets)
      for (const e of p.entries) {
        const list = sources.get(e.key) ?? [];
        list.push({ title: p.title, value: e.value });
        sources.set(e.key, list);
      }
    return sources;
  }, [source]);
}

export const promptOf = (p: Panel) => p.overrides.raw_prompt ?? '';
/** Legacy 只选空白分幕: neither a prompt nor dialogue. */
export const isEmptyFrame = (p: Panel) => !promptOf(p).trim() && !captionText(p.dialogues).trim();
