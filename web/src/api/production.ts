import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import { keys } from './keys';
import type { Episode, Job, Series, Strip } from './types';

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k${Date.now()}${Math.random().toString(16).slice(2)}`;
}

/**
 * Paid / GPU requests carry an idempotency key generated once per user action, so a network retry
 * (or a double click) never starts a second job.
 */
function useJobMutation<V>(episodeId: string, fn: (vars: V, key: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars, newKey()) as Promise<Job>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: keys.episode(episodeId) });
    },
  });
}

const ep = (episode_id: string) => ({ path: { episode_id } });

export interface RenderVars {
  panel_ids?: string[] | null;
  profile_id?: string | null;
  candidates?: number | null;
  variant_ids?: (string | null)[] | null;
  /** Queue flow: the first image of each panel without one goes straight into the album. */
  adopt_first?: boolean;
  /** 单幕重跑: the first new image replaces the album image (the old one stays a candidate). */
  adopt_replace?: boolean;
}

export function useRender(episodeId: string) {
  return useJobMutation(episodeId, async (vars: RenderVars, key) =>
    data(
      await api.POST('/api/episodes/{episode_id}/render', {
        params: ep(episodeId),
        body: { qa: false, ...vars, idempotency_key: key },
      }),
    ),
  );
}

/** Start a render on any album's episode (装配队列 page and context-menu actions). */
export function useRenderEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ episodeId, ...vars }: RenderVars & { episodeId: string }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/render', {
          params: ep(episodeId),
          body: { qa: false, ...vars, idempotency_key: newKey() },
        }),
      ) as unknown as Job,
    onSuccess: (_job, v) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: keys.episode(v.episodeId) });
    },
  });
}

// ------------------------------------------------------------------- strip
export function useLayoutStrip(episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      baseRevision,
      ...vars
    }: {
      relayout_lettering?: boolean;
      baseRevision: number;
    }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/strip/layout', {
          params: { ...ep(episodeId), query: { base_revision: baseRevision } },
          body: { relayout_lettering: true, ...vars },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.episode(episodeId) }),
  });
}

export function useSaveStrip(episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ strip, baseRevision }: { strip: Strip; baseRevision: number }) =>
      data(
        await api.PUT('/api/episodes/{episode_id}/strip', {
          params: {
            ...ep(episodeId),
            query: { base_revision: baseRevision },
          },
          body: strip,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.episode(episodeId) }),
  });
}

export function stripUrl(episodeId: string, bust: string | number) {
  const q = new URLSearchParams({ v: String(bust) });
  return `/api/episodes/${episodeId}/strip.png?${q}`;
}

/** Native reading uses the compositor's geometry and expanded captions for this saved snapshot. */
export function useReadingPreview(
  episode: Episode | undefined,
  series: Series | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['reading-preview', episode, series],
    enabled: enabled && !!episode && !!series,
    retry: false,
    queryFn: async ({ signal }) =>
      data(
        await api.GET('/api/episodes/{episode_id}/reading', {
          params: { path: { episode_id: episode!.id }, query: { width: 1600 } },
          signal,
        }),
      ),
  });
}

export function readingPanelUrl(
  episodeId: string,
  panelId: string,
  revision: string,
  width = 1600,
) {
  const query = new URLSearchParams({ width: String(width), revision });
  return `/api/episodes/${encodeURIComponent(episodeId)}/panels/${encodeURIComponent(panelId)}/image?${query}`;
}

export function readingStripUrl(episodeId: string, revision: string) {
  return `/api/episodes/${encodeURIComponent(episodeId)}/strip.png?${new URLSearchParams({ width: '1600', revision })}`;
}

export function useExportPresets() {
  return useQuery({
    queryKey: keys.presets,
    staleTime: Infinity,
    queryFn: async () =>
      data(await api.GET('/api/export/presets')) as unknown as {
        id: string;
        label: string;
        width: number;
        max_height: number;
        format: string;
      }[],
  });
}
