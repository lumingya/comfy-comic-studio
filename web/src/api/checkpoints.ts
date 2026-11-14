import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import type { components } from './schema';

export type CheckpointSummary = components['schemas']['CheckpointSummary'];
export type CheckpointPreview = components['schemas']['CheckpointPreview'];

const checkpointKey = (seriesId: string) => ['checkpoints', seriesId] as const;

export function useCheckpoints(seriesId: string) {
  return useQuery({
    queryKey: checkpointKey(seriesId),
    queryFn: async () =>
      data(
        await api.GET('/api/series/{series_id}/checkpoints', {
          params: { path: { series_id: seriesId } },
        }),
      ),
  });
}

export async function previewCheckpoint(seriesId: string, checkpointId: string) {
  return data(
    await api.GET('/api/series/{series_id}/checkpoints/{checkpoint_id}/preview', {
      params: { path: { series_id: seriesId, checkpoint_id: checkpointId } },
    }),
  );
}

export function useCreateCheckpoint(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const head = data(
        await api.GET('/api/series/{series_id}/head', {
          params: { path: { series_id: seriesId } },
        }),
      );
      return data(
        await api.POST('/api/series/{series_id}/checkpoints', {
          params: { path: { series_id: seriesId } },
          body: { name, expected_head: head.head },
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: checkpointKey(seriesId) }),
  });
}

export function useRestoreCheckpoint(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      checkpointId,
      expectedHead,
    }: {
      checkpointId: string;
      expectedHead: string;
    }) =>
      data(
        await api.POST('/api/series/{series_id}/checkpoints/{checkpoint_id}/restore', {
          params: { path: { series_id: seriesId, checkpoint_id: checkpointId } },
          body: { expected_head: expectedHead },
        }),
      ),
    onSuccess: async () => {
      await Promise.all(
        [
          'checkpoints',
          'series',
          'episodes',
          'episode',
          'workshop',
          'creation-kits',
          'reading-preview',
          'prompt',
          'strip-report',
          'workshop-queue',
          'trash',
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
}

export function useDeleteCheckpoint(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (checkpointId: string) =>
      api.DELETE('/api/series/{series_id}/checkpoints/{checkpoint_id}', {
        params: { path: { series_id: seriesId, checkpoint_id: checkpointId } },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: checkpointKey(seriesId) }),
  });
}
