import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api, data } from './client';
import { keys } from './keys';
import type { Job, JobEvent, JobItem } from './types';

export function useJobs(owner?: string, active = false, limit = 100) {
  return useQuery({
    queryKey: [...keys.jobs(owner), active, limit],
    queryFn: async () =>
      data(
        await api.GET('/api/jobs', { params: { query: { owner, active, limit } } }),
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
  'retried',
  'started',
  'failure_limit',
  'reconcile_miss',
]);

/** Item outcomes (`_finish` in jobs/runtime.py emits the item's new state as the event type). */
const ITEM_DONE = new Set(['complete', 'failed', 'uncertain', 'canceled', 'skipped']);
const SYNC_KEYS = new Set(['jobs', 'job', 'episode', 'episodes', 'series', keys.queue[0]]);

function clearLive(jobId?: string, idx?: number) {
  const live = useLive.getState();
  const keep = ([key]: [string, unknown]) =>
    jobId !== undefined &&
    (idx === undefined ? !key.startsWith(`${jobId}:`) : key !== `${jobId}:${idx}`);
  live.set({
    progress: Object.fromEntries(Object.entries(live.progress).filter(keep)),
    previews: Object.fromEntries(Object.entries(live.previews).filter(keep)),
  });
}

/** Connects once (mounted by the shell) and turns engine events into cache invalidations. */
export function useJobEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let connected = false;
    let polling = false;
    let delay = 1000;

    const refresh = (cancelRefetch = false, jobId?: string) =>
      qc.invalidateQueries(
        {
          predicate: ({ queryKey }) =>
            SYNC_KEYS.has(String(queryKey[0])) &&
            (queryKey[0] !== 'job' || !jobId || queryKey[1] === jobId),
        },
        { cancelRefetch },
      );

    // One fallback for every visible consumer, including newly submitted jobs and adopted takes.
    // Await each round: slow/offline HTTP requests must not accumulate overlapping polls.
    const poll = async () => {
      clearTimeout(pollTimer);
      if (closed || connected || document.hidden || polling) return;
      polling = true;
      try {
        await refresh();
      } finally {
        polling = false;
        if (!closed && !connected && !document.hidden) pollTimer = setTimeout(poll, 3000);
      }
    };
    const onVisible = () => {
      clearTimeout(pollTimer);
      if (document.hidden || closed) return;
      if (connected) void refresh(true);
      else void poll();
    };

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const current = new WebSocket(`${proto}://${window.location.host}/api/ws/jobs`);
      socket = current;
      current.onopen = () => {
        if (closed || socket !== current) return;
        connected = true;
        delay = 1000;
        clearTimeout(pollTimer);
        clearLive();
        useLive.getState().set({ connected: true });
        // Events are not replayed. This also closes the first-fetch/first-connection gap.
        if (!document.hidden) void refresh(true);
      };
      current.onmessage = (msg) => {
        if (closed || socket !== current || !connected) return;
        try {
          const event: unknown = JSON.parse(msg.data);
          if (event && typeof event === 'object' && 'type' in event && 'job_id' in event)
            handle(event as JobEvent);
        } catch {
          // Ignore a malformed frame; the next event or snapshot refresh still works.
        }
      };
      current.onclose = () => {
        if (closed || socket !== current) return;
        socket = null;
        connected = false;
        clearLive();
        useLive.getState().set({ connected: false });
        void poll();
        timer = setTimeout(connect, (delay = Math.min(delay * 2, 15000)));
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
      const itemDone = ITEM_DONE.has(event.type) && typeof event.idx === 'number';
      if (itemDone || event.type === 'started') clearLive(event.job_id, event.idx ?? undefined);
      if (event.type === 'canceled' || event.type === 'retried') clearLive(event.job_id);
      if (REFRESH.has(event.type) || itemDone) {
        // A finished item has already written (and with adopt_first adopted) its take: the
        // reader, its template preview, candidates and the queue card show it right away instead
        // of when the whole job ends.
        void refresh(true, event.job_id);
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      if (socket) socket.onopen = socket.onmessage = socket.onclose = null;
      socket?.close();
      clearLive();
      useLive.getState().set({ connected: null });
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
  const details = useQueries({
    queries: (jobs.data ?? []).map((j) => ({
      queryKey: keys.job(j.id),
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
