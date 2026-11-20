import { useMutation } from '@tanstack/react-query';
import { api, data } from '../../api/client';
import type { components } from '../../api/schema';
import type { PacingPreview } from '../../api/types';

export const PACING_PRESETS = ['auto', 'compact', 'lyrical', 'cinematic'] as const;
export type PacingPreset = (typeof PACING_PRESETS)[number];

export function useCanvasPacingSuggest(episodeId: string) {
  return useMutation({
    mutationFn: async (preset: PacingPreset): Promise<PacingPreview> => {
      return data(
        await api.POST('/api/episodes/{episode_id}/pacing/suggest', {
          params: {
            path: { episode_id: episodeId },
            query: preset === 'auto' ? undefined : { preset },
          },
        }),
      );
    },
  });
}

export function useAvoidLettering(episodeId: string) {
  return useMutation({
    mutationFn: async (body: components['schemas']['LetteringAvoidRequest']) => {
      return data(
        await api.POST('/api/episodes/{episode_id}/strip/avoid-lettering', {
          params: { path: { episode_id: episodeId } },
          body,
        }),
      );
    },
  });
}
