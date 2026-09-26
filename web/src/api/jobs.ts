import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api, data } from './client';
import { keys } from './keys';
import type { Job, JobEvent, JobItem } from './types';

export function useJobs(owner?: string, active = false) {
  return useQuery({
    queryKey: [...keys.jobs(owner), active],
    queryFn: async () =>
      data(
        await api.GET('/api/jobs', { params: { query: { owner, active, limit: 100 } } }),
      ) as unknown as Job[],
  });
}

export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: keys.job(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      data(
        await api.GET('/api/jobs/{job_id}', { params: { path: { job_id: id! } } }),
      ) as unknown as Job,
  });
}

export type JobControl = 'pause' | 'resume' | 'cancel';

export function useJobControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: JobControl }) => {
      const params = { path: { job_id: id } };
      const paths = {
        pause: '/api/jobs/{job_id}/pause',
        resume: '/api/jobs/{job_id}/resume',
        cancel: '/api/jobs/{job_id}/cancel',
      } as const;
      return data(await api.POST(paths[action], { params }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      indexes?: number[];
      from_index?: number;
      confirm_uncertain?: boolean;
      include_complete?: boolean;
    }) => {
      const { id, ...body } = vars;
      return data(
        await api.POST('/api/jobs/{job_id}/retry', { params: { path: { job_id: id } }, body }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useResolveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      idx: number;
      action: 'reconcile' | 'failed' | 'resubmit';
    }) =>
      data(
        await api.POST('/api/jobs/{job_id}/items/{idx}/resolve', {
          params: { path: { job_id: vars.id, idx: vars.idx } },
          body: { action: vars.action },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

// ---------------------------------------------------------- live events (WS)
interface LiveState {
  /** null until the first connection attempt settles. */
  connected: boolean | null;
  /** Latest progress per job item: `${job}:${idx}` → 0..1 */
  progress: Record<string, number>;
  /** Latest live preview (data URL) per job item. */
  previews: Record<string, string>;
  set: (patch: Partial<Omit<LiveState, 'set'>>) => void;
}

export const useLive = create<LiveState>((set) => ({
  connected: null,
  progress: {},
  previews: {},
  set: (patch) => set(patch),
}));

const REFRESH = new Set([
  'state',
  'submitted',
  'canceled',
  'resumed',
  'failure_limit',
  'reconcile_miss',
]);

/** Connects once (mounted by the shell) and turns engine events into cache invalidations. */
export function useJobEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let delay = 1000;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${window.location.host}/api/ws/jobs`);
      socket.onopen = () => {
        delay = 1000;
        useLive.getState().set({ connected: true });
      };
      socket.onmessage = (msg) => handle(JSON.parse(msg.data));
      socket.onclose = () => {
        useLive.getState().set({ connected: false });
        if (!closed) timer = setTimeout(connect, (delay = Math.min(delay * 2, 15000)));
      };
    };

    const handle = (event: JobEvent & { type: string }) => {
      if (event.type === 'hello') return;
      const live = useLive.getState();
      const key = `${event.job_id}:${event.idx}`;
      const d = event.data ?? {};
      if (event.type === 'progress' && typeof d.value === 'number' && typeof d.max === 'number') {
        live.set({ progress: { ...live.progress, [key]: d.max ? d.value / d.max : 0 } });
      }
      if (
        event.type === 'progress' &&
        d.type === 'preview' &&
        typeof d.data === 'string' &&
        d.data
      ) {
        const mime = d.format === 'png' || d.format === 'PNG' ? 'image/png' : 'image/jpeg';
        live.set({ previews: { ...live.previews, [key]: `data:${mime};base64,${d.data}` } });
      }
      if (REFRESH.has(event.type)) {
        qc.invalidateQueries({ queryKey: ['jobs'] });
        qc.invalidateQueries({ queryKey: keys.job(event.job_id) });
        qc.invalidateQueries({ queryKey: ['episode'] });
      }
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [qc]);
}

export interface ActiveItem {
  jobId: string;
  idx: number;
  state: JobItem['state'];
  label: string;
  variantId: string | null;
}

/** In-flight items of this episode's active jobs, grouped by panel (for live previews). */
export function useActiveRenders(episodeId: string) {
  const jobs = useJobs(episodeId, true);
  const offline = useLive((s) => s.connected === false);
  const details = useQueries({
    queries: (jobs.data ?? []).map((j) => ({
      queryKey: keys.job(j.id),
      refetchInterval: offline ? 3000 : false,
      queryFn: async () =>
        data(
          await api.GET('/api/jobs/{job_id}', { params: { path: { job_id: j.id } } }),
        ) as unknown as Job,
    })),
  });
  const byPanel: Record<string, ActiveItem[]> = {};
  for (const q of details) {
    for (const item of q.data?.items ?? []) {
      const meta = item.input?.meta;
      if (!meta?.panel_id || !['pending', 'running', 'uncertain'].includes(item.state)) continue;
      (byPanel[meta.panel_id] ??= []).push({
        jobId: q.data!.id,
        idx: item.idx,
        state: item.state,
        label: item.label,
        variantId: meta.variant_id ?? null,
      });
    }
  }
  return { jobs: jobs.data ?? [], byPanel };
}
