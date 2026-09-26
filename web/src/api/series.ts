import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import { keys } from './keys';
import type { Episode, EpisodeSummary, Page, Panel, PromptPreview, Series } from './types';

const PAGE = 50;

// ------------------------------------------------------------------ series
export function useSeriesList(deleted = false) {
  return useQuery({
    queryKey: keys.seriesList(deleted),
    queryFn: async () => data(await api.GET('/api/series', { params: { query: { deleted } } })),
  });
}

export function useSeries(id: string | undefined) {
  return useQuery({
    queryKey: keys.series(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      data(await api.GET('/api/series/{series_id}', { params: { path: { series_id: id! } } })),
  });
}

export function useCreateSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { title: string; subtitle?: string }) =>
      data(await api.POST('/api/series', { body: { subtitle: '', ...body } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['series'] }),
  });
}

export type SeriesChanges = Partial<
  Pick<Series, 'title' | 'subtitle' | 'status' | 'bible' | 'variants' | 'variables'>
> & { default_profile_id?: string | null };

export function usePatchSeries(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SeriesChanges) =>
      data(
        await api.PATCH('/api/series/{series_id}', {
          params: { path: { series_id: id } },
          body: body as never,
        }),
      ),
    onSuccess: (series) => {
      qc.setQueryData(keys.series(id), series);
      qc.invalidateQueries({ queryKey: keys.seriesList() });
    },
  });
}

export function useTrashSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      api.DELETE('/api/series/{series_id}', { params: { path: { series_id: id } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series'] });
      qc.invalidateQueries({ queryKey: keys.trash });
    },
  });
}

// ---------------------------------------------------------------- episodes
export function useEpisodes(seriesId: string | undefined, offset = 0) {
  return useQuery({
    queryKey: keys.episodes(seriesId ?? '', offset),
    enabled: !!seriesId,
    queryFn: async () =>
      data(
        await api.GET('/api/series/{series_id}/episodes', {
          params: { path: { series_id: seriesId! }, query: { offset, limit: PAGE } },
        }),
      ) as unknown as Page<EpisodeSummary>,
  });
}

export function useEpisode(id: string | undefined) {
  return useQuery({
    queryKey: keys.episode(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      data(await api.GET('/api/episodes/{episode_id}', { params: { path: { episode_id: id! } } })),
  });
}

export function useCreateEpisode(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { title: string; synopsis?: string }) =>
      data(
        await api.POST('/api/series/{series_id}/episodes', {
          params: { path: { series_id: seriesId } },
          body: { synopsis: '', ...body },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.episodesOf(seriesId) }),
  });
}

export function useGenerateEpisode(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { sentence: string; title?: string }) =>
      data(
        await api.POST('/api/series/{series_id}/episodes/generate', {
          params: { path: { series_id: seriesId } },
          body,
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.episodesOf(seriesId) });
      qc.invalidateQueries({ queryKey: keys.series(seriesId) });
    },
  });
}

export function useTrashEpisode(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      api.DELETE('/api/episodes/{episode_id}', { params: { path: { episode_id: id } } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.episodesOf(seriesId) });
      qc.invalidateQueries({ queryKey: keys.trash });
    },
  });
}

/** Every episode mutation answers with the full Episode; keep the cache in sync. */
function useEpisodeMutation<V>(episodeId: string, fn: (vars: V) => Promise<Episode>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (ep) => {
      qc.setQueryData(keys.episode(episodeId), ep);
      qc.invalidateQueries({ queryKey: ['prompt', episodeId] });
      qc.invalidateQueries({ queryKey: keys.episodesOf(ep.series_id) });
    },
  });
}

const ep = (episode_id: string) => ({ path: { episode_id } });

export function usePatchEpisode(episodeId: string) {
  return useEpisodeMutation(episodeId, async (body: { title?: string; synopsis?: string }) =>
    data(await api.PATCH('/api/episodes/{episode_id}', { params: ep(episodeId), body })),
  );
}

export function useAddPanel(episodeId: string) {
  return useEpisodeMutation(
    episodeId,
    async (vars: { panel?: Partial<Panel>; after?: string | null }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/panels', {
          params: ep(episodeId),
          body: { panel: vars.panel ?? {}, after: vars.after ?? null },
        }),
      ),
  );
}

export function usePatchPanel(episodeId: string) {
  return useEpisodeMutation(
    episodeId,
    async (vars: { panelId: string; changes: Record<string, unknown>; revision?: number }) =>
      data(
        await api.PATCH('/api/episodes/{episode_id}/panels/{panel_id}', {
          params: { path: { episode_id: episodeId, panel_id: vars.panelId } },
          body: { changes: vars.changes, revision: vars.revision ?? null },
        }),
      ),
  );
}

export function useDeletePanel(episodeId: string) {
  return useEpisodeMutation(episodeId, async (panelId: string) =>
    data(
      await api.DELETE('/api/episodes/{episode_id}/panels/{panel_id}', {
        params: { path: { episode_id: episodeId, panel_id: panelId } },
      }),
    ),
  );
}

export function useDuplicatePanel(episodeId: string) {
  return useEpisodeMutation(episodeId, async (panelId: string) =>
    data(
      await api.POST('/api/episodes/{episode_id}/panels/{panel_id}/duplicate', {
        params: { path: { episode_id: episodeId, panel_id: panelId } },
      }),
    ),
  );
}

export function useReorderPanels(episodeId: string) {
  return useEpisodeMutation(episodeId, async (order: string[]) =>
    data(
      await api.POST('/api/episodes/{episode_id}/panels/reorder', {
        params: ep(episodeId),
        body: { order, revision: null },
      }),
    ),
  );
}

export type TakeAction = 'adopt' | 'reject' | 'restore';

export function useTakeAction(episodeId: string) {
  return useEpisodeMutation(
    episodeId,
    async ({ takeId, action }: { takeId: string; action: TakeAction }) => {
      const params = { path: { episode_id: episodeId, take_id: takeId } };
      const paths = {
        adopt: '/api/episodes/{episode_id}/takes/{take_id}/adopt',
        reject: '/api/episodes/{episode_id}/takes/{take_id}/reject',
        restore: '/api/episodes/{episode_id}/takes/{take_id}/restore',
      } as const;
      return data(await api.POST(paths[action], { params }));
    },
  );
}

export function usePrompt(
  episodeId: string,
  panelId: string | undefined,
  variantId?: string | null,
) {
  return useQuery({
    queryKey: keys.prompt(episodeId, panelId ?? '', variantId),
    enabled: !!panelId,
    queryFn: async () =>
      data(
        await api.GET('/api/episodes/{episode_id}/panels/{panel_id}/prompt', {
          params: {
            path: { episode_id: episodeId, panel_id: panelId! },
            query: { variant_id: variantId ?? undefined },
          },
        }),
      ) as unknown as PromptPreview,
  });
}
