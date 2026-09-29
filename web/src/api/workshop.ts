import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, data } from './client';
import { keys } from './keys';
import type { QueueStatus, Series } from './types';

export type Preset = Series['presets'][number];
export type PresetEntry = Preset['entries'][number];
export type PresetGroup = Preset['groups'][number];

export const workshopKey = ['workshop'] as const;

/** The hidden 创作工坊 series: its episodes are the storyboards, `presets` the presets. */
export function useWorkshop() {
  return useQuery({
    queryKey: workshopKey,
    staleTime: 60_000,
    queryFn: async () => withBindings(data(await api.GET('/api/workshop'))),
  });
}

/** Presets saved before node bindings existed arrive without the list. */
function withBindings<T extends { presets: Preset[] }>(series: T): T {
  return { ...series, presets: series.presets.map((p) => ({ ...p, bindings: p.bindings ?? [] })) };
}

/** Save the preset library (the whole list, like the legacy autosave). */
export function useSavePresets(workshopId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (presets: Preset[]) =>
      data(
        await api.PATCH('/api/series/{series_id}', {
          params: { path: { series_id: workshopId! } },
          body: { presets } as never,
        }),
      ),
    onSuccess: (saved) => {
      const series = withBindings(saved);
      qc.setQueryData(workshopKey, series);
      qc.setQueryData(keys.series(series.id!), series);
    },
  });
}

export interface AssembleVars {
  storyboard_id: string;
  preset_ids: string[];
  title: string;
  profile_id?: string | null;
}

/** Storyboard + presets → a new album waiting in the queue (no model call). */
export function useAssemble() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AssembleVars) =>
      data(await api.POST('/api/workshop/assemble', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series'] });
      qc.invalidateQueries({ queryKey: ['episodes'] });
    },
  });
}

/** `Series.subtitle` of the one-frame albums made by 预设工坊「独立试绘」 (server constant). */
export const PREVIEW_SUBTITLE = '预设试绘';

export interface PreviewVars {
  preset_ids: string[];
  prompt: string;
  title?: string;
  profile_id?: string | null;
}

/** 预设「独立试绘」: one prompt + presets → a one-frame album waiting in the queue. */
export function usePreviewPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PreviewVars) =>
      data(await api.POST('/api/workshop/preview', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series'] });
      qc.invalidateQueries({ queryKey: ['episodes'] });
    },
  });
}

/** 装配队列「克隆」: a new standby album with the task's frames, presets and profile. */
export function useCloneTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (seriesId: string) =>
      data(
        await api.POST('/api/workshop/tasks/{series_id}/clone', {
          params: { path: { series_id: seriesId } },
          body: {},
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series'] });
      qc.invalidateQueries({ queryKey: ['episodes'] });
    },
  });
}

let seq = 0;
/** Local ids for new presets / entries / groups (the server keeps whatever we send). */
export function localId(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

/** `{name}` tokens in a prompt, in order of appearance (duplicates removed). */
export function promptVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([^\s{}]{1,64})\}/g)].map((m) => m[1]))];
}

/** Replace `{name}` with the album's values (unknown names are left as written). */
export function fillVariables(text: string, vars: Record<string, string>) {
  return text.replace(/\{([^\s{}]{1,64})\}/g, (all, k: string) => (k in vars ? vars[k] : all));
}

/** The variables a storyboard uses (prompts, negatives and captions). */
export function useBoardVariables(id: string | undefined) {
  const q = useQuery({
    queryKey: ['episode', id ?? ''],
    enabled: !!id,
    queryFn: async () =>
      data(await api.GET('/api/episodes/{episode_id}', { params: { path: { episode_id: id! } } })),
  });
  const vars = useMemo(() => {
    const text = (q.data?.panels ?? [])
      .flatMap((p) => [
        p.overrides.raw_prompt ?? '',
        p.overrides.raw_negative ?? '',
        ...p.dialogues.map((d) => d.text),
      ])
      .join('\n');
    return promptVariables(text);
  }, [q.data]);
  return { vars, episode: q.data };
}

// ---------------------------------------------------------------- 装配队列
/** The server-side queue; besides the job events it is polled while the lane has work. */
export function useQueue() {
  return useQuery({
    queryKey: keys.queue,
    refetchInterval: (q) => (q.state.data?.lane.length || q.state.data?.active ? 5000 : false),
    queryFn: async () => data(await api.GET('/api/workshop/queue')) as QueueStatus,
  });
}

export type QueueAction =
  | { action: 'start'; ids: string[] }
  | { action: 'remove'; id: string }
  | { action: 'pause' | 'resume' | 'clear' }
  | { action: 'order'; ids: string[] }
  | { action: 'concurrency'; value: number | null };

async function queueCall(v: QueueAction): Promise<QueueStatus> {
  switch (v.action) {
    case 'start':
      return data(
        await api.POST('/api/workshop/queue/start', { body: { album_ids: v.ids } }),
      ) as QueueStatus;
    case 'remove':
      return data(
        await api.POST('/api/workshop/queue/remove', { body: { album_id: v.id } }),
      ) as QueueStatus;
    case 'pause':
      return data(await api.POST('/api/workshop/queue/pause')) as QueueStatus;
    case 'resume':
      return data(await api.POST('/api/workshop/queue/resume')) as QueueStatus;
    case 'clear':
      return data(await api.POST('/api/workshop/queue/clear')) as QueueStatus;
    case 'order':
      return data(
        await api.PUT('/api/workshop/queue/order', { body: { album_ids: v.ids } }),
      ) as QueueStatus;
    case 'concurrency':
      return data(
        await api.PATCH('/api/workshop/queue', { body: { concurrency: v.value } }),
      ) as QueueStatus;
  }
}

/** Every queue command answers with the new queue state. The card order is applied at once. */
export function useQueueAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: queueCall,
    onMutate: (v) => {
      const prev = qc.getQueryData<QueueStatus>(keys.queue);
      if (v.action === 'order' && prev) qc.setQueryData(keys.queue, { ...prev, order: v.ids });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.queue, ctx.prev);
    },
    onSuccess: (q) => {
      qc.setQueryData(keys.queue, q);
      // Starting the lane creates a job at once.
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
