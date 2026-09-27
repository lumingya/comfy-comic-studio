import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data } from './client';
import { keys } from './keys';
import type { Series } from './types';

export type Preset = Series['presets'][number];
export type PresetEntry = Preset['entries'][number];
export type PresetGroup = Preset['groups'][number];

export const workshopKey = ['workshop'] as const;

/** The hidden 创作工坊 series: its episodes are the storyboards, `presets` the presets. */
export function useWorkshop() {
  return useQuery({
    queryKey: workshopKey,
    staleTime: 60_000,
    queryFn: async () => data(await api.GET('/api/workshop')),
  });
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
    onSuccess: (series) => {
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
