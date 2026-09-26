import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import { keys } from './keys';
import type {
  CompositionPreview,
  LetterStyle,
  PacingChanges,
  PacingPreview,
  StripReport,
} from './types';

const ep = (episode_id: string) => ({ path: { episode_id } });

export function useSfxPresets() {
  return useQuery({
    queryKey: keys.sfxPresets,
    staleTime: Infinity,
    queryFn: async () =>
      data(await api.GET('/api/lettering/sfx-presets')) as Record<string, LetterStyle>,
  });
}

export function useStripReport(episodeId: string, variantId: string | null, bust: string) {
  return useQuery({
    queryKey: [...keys.stripReport(episodeId), variantId, bust],
    queryFn: async () =>
      data(
        await api.GET('/api/episodes/{episode_id}/strip/report', {
          params: { ...ep(episodeId), query: { variant_id: variantId } },
        }),
      ) as unknown as StripReport,
  });
}

export function usePacingSuggest(episodeId: string) {
  return useMutation({
    mutationFn: async () =>
      data(
        await api.POST('/api/episodes/{episode_id}/pacing/suggest', { params: ep(episodeId) }),
      ) as PacingPreview,
  });
}

export function usePacingApply(episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      base_revision: number;
      patches: { panel_id: string; changes: PacingChanges }[];
    }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/pacing/apply', {
          params: ep(episodeId),
          body: vars,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.episode(episodeId) }),
  });
}

export function useCompositionPreview(episodeId: string) {
  return useMutation({
    mutationFn: async (vars: { panelId: string; dialect?: 'tags' | 'natural' }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/panels/{panel_id}/composition', {
          params: {
            path: { episode_id: episodeId, panel_id: vars.panelId },
            query: { dialect: vars.dialect ?? 'tags' },
          },
        }),
      ) as CompositionPreview,
  });
}
