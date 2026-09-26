import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import { keys } from './keys';
import type { Job, Proposal, Strip } from './types';

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
  qa?: boolean;
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

export function useFinalize(episodeId: string) {
  return useJobMutation(
    episodeId,
    async (vars: { take_ids?: string[] | null; profile_id?: string | null }, key) =>
      data(
        await api.POST('/api/episodes/{episode_id}/finalize', {
          params: ep(episodeId),
          body: { ...vars, idempotency_key: key },
        }),
      ),
  );
}

export type EditKind = 'inpaint' | 'outpaint' | 'edit';

export function useEditTake(episodeId: string) {
  return useJobMutation(
    episodeId,
    async (vars: { take_id: string; kind: EditKind; params: Record<string, unknown> }, key) =>
      data(
        await api.POST('/api/episodes/{episode_id}/edit', {
          params: ep(episodeId),
          body: { ...vars, idempotency_key: key },
        }),
      ),
  );
}

export function useQA(episodeId: string) {
  return useJobMutation(
    episodeId,
    async (vars: { take_ids?: string[] | null; votes?: number; auto_adopt?: boolean }, key) =>
      data(
        await api.POST('/api/episodes/{episode_id}/qa', {
          params: ep(episodeId),
          body: { ...vars, idempotency_key: key },
        }),
      ),
  );
}

// ------------------------------------------------------------------- strip
export function useLayoutStrip(episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { relayout_lettering?: boolean; variant_id?: string | null }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/strip/layout', {
          params: ep(episodeId),
          body: { relayout_lettering: true, ...vars },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.episode(episodeId) }),
  });
}

export function useSaveStrip(episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (strip: Strip) =>
      data(
        await api.PUT('/api/episodes/{episode_id}/strip', { params: ep(episodeId), body: strip }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.episode(episodeId) }),
  });
}

export function stripUrl(episodeId: string, bust: string | number, variantId?: string | null) {
  const q = new URLSearchParams({ v: String(bust) });
  if (variantId) q.set('variant_id', variantId);
  return `/api/episodes/${episodeId}/strip.png?${q}`;
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

// --------------------------------------------------------------- assistant
export function usePropose(episodeId: string) {
  return useMutation({
    mutationFn: async (instruction: string) =>
      data(
        await api.POST('/api/episodes/{episode_id}/assistant/propose', {
          params: ep(episodeId),
          body: { instruction },
        }),
      ) as unknown as Proposal,
  });
}

export function useApplyProposal(episodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { proposal: Proposal; accepted: string[] }) =>
      data(
        await api.POST('/api/episodes/{episode_id}/assistant/apply', {
          params: ep(episodeId),
          body: {
            ops: vars.proposal.ops as unknown as Record<string, unknown>[],
            accepted: vars.accepted,
            base_revision: vars.proposal.base_revision,
          },
        }),
      ) as unknown as { applied: string[]; revision: number },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.episode(episodeId) });
      qc.invalidateQueries({ queryKey: ['series'] });
    },
  });
}
