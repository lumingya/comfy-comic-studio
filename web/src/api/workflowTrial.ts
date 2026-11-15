import { useMutation, useQueryClient } from '@tanstack/react-query';
import { raw } from './client';
import { keys } from './keys';
import type { Episode, Job, Series } from './types';

export interface WorkflowTrialRequest {
  instance_id?: string;
  prompt: string;
  negative_prompt?: string;
  width?: number | null;
  height?: number | null;
  values?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  idempotency_key: string;
}
export interface WorkflowTrialResult {
  series: Series;
  episode: Episode;
  job: Job;
}

export function useWorkflowTrial(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: WorkflowTrialRequest): Promise<WorkflowTrialResult> => {
      const response = await raw(`/api/workflows/${encodeURIComponent(id)}/trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return response.json();
    },
    onSuccess: (result) => {
      client.setQueryData(keys.job(result.job.id), result.job);
      client.setQueryData(keys.episode(result.episode.id), result.episode);
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: ['series'] });
      void client.invalidateQueries({ queryKey: keys.queue });
    },
  });
}
