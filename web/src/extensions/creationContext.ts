import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { components } from '../api/schema';

type WireContext = components['schemas']['MioContract_CreationContextV1'];
export type CreationContext = Omit<Required<WireContext>, 'selection' | 'revisions'> & {
  selection: Required<NonNullable<WireContext['selection']>>;
  revisions: Required<NonNullable<WireContext['revisions']>>;
};
export interface CreationInput {
  route: CreationContext['route'];
  series_id?: string | null;
  episode_id?: string | null;
  panel_ids?: readonly string[];
  revision?: number | null;
}

const listeners = new Set<() => void>();
let owner: symbol | null = null;
let snapshot: CreationContext = {
  version: 1,
  seq: 0,
  context_id: 'none',
  route: 'other',
  series_id: null,
  episode_id: null,
  selection: { kind: 'none', ids: [], truncated: false },
  revisions: { episode: null },
};

function content(input: CreationInput) {
  const ids = [...new Set(input.panel_ids ?? [])].filter((id) => id.length > 0 && id.length <= 128);
  return {
    version: 1 as const,
    route: input.route,
    series_id: input.series_id && input.series_id.length <= 128 ? input.series_id : null,
    episode_id: input.episode_id && input.episode_id.length <= 128 ? input.episode_id : null,
    selection: {
      kind: ids.length ? ('panels' as const) : ('none' as const),
      ids: ids.slice(0, 100),
      truncated: ids.length > 100,
    },
    revisions: {
      episode:
        typeof input.revision === 'number' &&
        Number.isInteger(input.revision) &&
        input.revision >= 0
          ? input.revision
          : null,
    },
  };
}

/** Publish semantic state, never render counts, business text, media or configuration. */
export function publishCreationContext(token: symbol, input: CreationInput): void {
  const next = content(input);
  const { seq: _seq, context_id: _id, ...previous } = snapshot;
  owner = token;
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  snapshot = Object.freeze({
    ...next,
    seq: snapshot.seq + 1,
    context_id: crypto.randomUUID(),
    selection: Object.freeze({
      ...next.selection,
      ids: Object.freeze(next.selection.ids) as unknown as string[],
    }),
    revisions: Object.freeze(next.revisions),
  });
  listeners.forEach((listener) => listener());
}

export function releaseCreationContext(token: symbol): void {
  if (owner !== token) return;
  publishCreationContext(token, { route: 'other' });
  owner = null;
}

export const getCreationContext = () => snapshot;
/** A context-menu target is an invocation scope, not a persistent selection edit. */
export function captureCreationSelection(
  base: CreationContext,
  ids: readonly string[],
): CreationContext {
  const next = content({
    route: base.route,
    series_id: base.series_id,
    episode_id: base.episode_id,
    revision: base.revisions.episode,
    panel_ids: ids,
  });
  return Object.freeze({
    ...next,
    seq: base.seq,
    context_id: crypto.randomUUID(),
    selection: Object.freeze({
      ...next.selection,
      ids: Object.freeze(next.selection.ids) as unknown as string[],
    }),
    revisions: Object.freeze(next.revisions),
  });
}
export const subscribeCreationContext = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useCreationContext = () =>
  useSyncExternalStore(subscribeCreationContext, getCreationContext, getCreationContext);

export function usePublishCreationContext(input: CreationInput): void {
  const token = useRef(Symbol('creation-context'));
  const signature = JSON.stringify(content(input));
  useLayoutEffect(() => {
    publishCreationContext(token.current, input);
  }, [signature]);
  useLayoutEffect(() => () => releaseCreationContext(token.current), []);
}
