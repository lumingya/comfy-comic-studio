import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import { keys } from './keys';
import type { components } from './schema';
import type { Episode, EpisodeSummary, Page, Series } from './types';

type S = components['schemas'];
export type TransferCommand = S['PanelTransfer'];
export type TransferResult = S['TransferResult'];
export type VariableCommand = S['VariableOperation'];
export type VariablePreview = S['VariablePreview'];
export type VariableSearch = S['VariableSearch'];

export async function listOrganizableEpisodes(seriesId: string): Promise<EpisodeSummary[]> {
  const result: EpisodeSummary[] = [];
  let offset = 0;
  while (true) {
    const page = data(
      await api.GET('/api/series/{series_id}/episodes', {
        params: { path: { series_id: seriesId }, query: { offset, limit: 200 } },
      }),
    ) as unknown as Page<EpisodeSummary>;
    result.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || !page.items.length) return result;
  }
}

export function useOrganizableEpisodes(seriesId: string) {
  return useQuery({
    queryKey: [...keys.episodesOf(seriesId), 'organize'],
    queryFn: () => listOrganizableEpisodes(seriesId),
  });
}

export async function getOrganizableEpisode(episodeId: string) {
  return data(
    await api.GET('/api/episodes/{episode_id}', {
      params: { path: { episode_id: episodeId } },
    }),
  );
}

export async function transferPanels(seriesId: string, body: TransferCommand) {
  return data(
    await api.POST('/api/series/{series_id}/panels/transfer', {
      params: { path: { series_id: seriesId } },
      body,
    }),
  );
}

export async function copyOrganizableEpisode(episode: Episode) {
  return data(
    await api.POST('/api/episodes/{episode_id}/copy', {
      params: { path: { episode_id: episode.id } },
      body: { revision: episode.revision },
    }),
  );
}

export async function nudgeEpisode(seriesId: string, episodeId: string, delta: -1 | 1) {
  const episodes = await listOrganizableEpisodes(seriesId);
  const index = episodes.findIndex((ep) => ep.id === episodeId);
  const other = index + delta;
  if (index < 0 || other < 0 || other >= episodes.length) return [];
  const revisions = Object.fromEntries(
    await Promise.all(
      episodes.map(async (ep) => [
        ep.id,
        ep.revision ?? (await getOrganizableEpisode(ep.id)).revision,
      ]),
    ),
  );
  [episodes[index], episodes[other]] = [episodes[other], episodes[index]];
  return data(
    await api.POST('/api/series/{series_id}/episodes/reorder', {
      params: { path: { series_id: seriesId } },
      body: { order: episodes.map((ep) => ep.id), revisions },
    }),
  );
}

export async function findVariable(seriesId: string, key: string) {
  return data(
    await api.POST('/api/series/{series_id}/variables/find', {
      params: { path: { series_id: seriesId } },
      body: { key },
    }),
  );
}

export async function previewVariable(seriesId: string, body: VariableCommand) {
  return data(
    await api.POST('/api/series/{series_id}/variables/preview', {
      params: { path: { series_id: seriesId } },
      body,
    }),
  );
}

export async function applyVariable(seriesId: string, body: S['VariableApply']) {
  return data(
    await api.POST('/api/series/{series_id}/variables/apply', {
      params: { path: { series_id: seriesId } },
      body,
    }),
  );
}

export async function refreshOrganizedWork(
  qc: QueryClient,
  seriesId: string,
  episodes: Episode[] = [],
  series?: Series,
) {
  for (const episode of episodes) qc.setQueryData(keys.episode(episode.id), episode);
  if (series) {
    qc.setQueryData(keys.series(seriesId), series);
    if (series.kind === 'workshop') qc.setQueryData(['workshop'], series);
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.episodesOf(seriesId) }),
    qc.invalidateQueries({ queryKey: ['series'] }),
    qc.invalidateQueries({ queryKey: ['prompt'] }),
    qc.invalidateQueries({ queryKey: keys.queue }),
    qc.invalidateQueries({ queryKey: ['workshop'] }),
  ]);
}
