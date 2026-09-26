import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data, raw } from './client';
import { keys } from './keys';
import type {
  AppSettings,
  ComfyInstance,
  RenderProfile,
  TrashItem,
  WorkflowSummary,
} from './types';

// ---------------------------------------------------------------- settings
export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => data(await api.GET('/api/settings')) as unknown as AppSettings,
  });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      data(await api.PATCH('/api/settings', { body: patch })) as unknown as AppSettings,
    onSuccess: (s) => qc.setQueryData(keys.settings, s),
  });
}

export function useRegistry() {
  return useQuery({
    queryKey: keys.registry,
    staleTime: Infinity,
    queryFn: async () =>
      data(await api.GET('/api/registry')) as unknown as Record<
        string,
        { id: string; title: string; source?: string }[]
      >,
  });
}

// --------------------------------------------------------------- workflows
interface NodeInput {
  node: string;
  class_type: string;
  input: string;
  value: string;
}

export interface Diagnosis {
  ok: boolean;
  instance: string;
  missing_nodes: { class_type: string; nodes: string[] }[];
  missing_models: NodeInput[];
  invalid_values: (NodeInput & { allowed: string[] })[];
  models: Record<string, string[]>;
}

export function useWorkflows() {
  return useQuery({
    queryKey: keys.workflows,
    queryFn: async () => data(await api.GET('/api/workflows')) as unknown as WorkflowSummary[],
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: keys.workflow(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      data(
        await api.GET('/api/workflows/{workflow_id}', { params: { path: { workflow_id: id! } } }),
      ) as unknown as Record<string, unknown> & { describe: Record<string, unknown> },
  });
}

export function useImportWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; graph: Record<string, unknown> }) =>
      data(await api.POST('/api/workflows', { body: { ...body, notes: '' } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workflows }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      api.DELETE('/api/workflows/{workflow_id}', { params: { path: { workflow_id: id } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workflows }),
  });
}

export function useCopyWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      data(
        await api.POST('/api/workflows/{workflow_id}/copy', {
          params: { path: { workflow_id: id } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workflows }),
  });
}

export function useDiagnoseWorkflow() {
  return useMutation({
    mutationFn: async (vars: { id: string; instance: string }) =>
      data(
        await api.POST('/api/workflows/{workflow_id}/diagnose', {
          params: { path: { workflow_id: vars.id }, query: { instance_id: vars.instance } },
        }),
      ) as unknown as Diagnosis,
  });
}

// ---------------------------------------------------------------- profiles
export function useProfiles() {
  return useQuery({
    queryKey: keys.profiles,
    queryFn: async () => data(await api.GET('/api/profiles')),
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ profile, isNew }: { profile: RenderProfile; isNew: boolean }) =>
      isNew
        ? data(await api.POST('/api/profiles', { body: profile }))
        : data(
            await api.PUT('/api/profiles/{profile_id}', {
              params: { path: { profile_id: profile.id! } },
              body: profile,
            }),
          ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profiles }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      api.DELETE('/api/profiles/{profile_id}', { params: { path: { profile_id: id } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profiles }),
  });
}

// --------------------------------------------------------------- instances
export function useInstances() {
  return useQuery({
    queryKey: keys.instances,
    queryFn: async () =>
      data(await api.GET('/api/instances')) as unknown as {
        instances: ComfyInstance[];
        pool: Record<string, unknown>;
      },
  });
}

export function useSaveInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ instance, isNew }: { instance: ComfyInstance; isNew: boolean }) =>
      isNew
        ? data(await api.POST('/api/instances', { body: instance }))
        : data(
            await api.PUT('/api/instances/{instance_id}', {
              params: { path: { instance_id: instance.id! } },
              body: instance,
            }),
          ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.instances }),
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      api.DELETE('/api/instances/{instance_id}', { params: { path: { instance_id: id } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.instances }),
  });
}

export function useInstanceHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      data(
        await api.GET('/api/instances/{instance_id}/health', {
          params: { path: { instance_id: id } },
        }),
      ) as unknown as { id: string; ok: boolean; stats: Record<string, unknown> },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.instances }),
  });
}

// ------------------------------------------------------------ trash / io
export function useTrash() {
  return useQuery({
    queryKey: keys.trash,
    queryFn: async () =>
      data(await api.GET('/api/trash')) as unknown as {
        items: TrashItem[];
        retention_days: number;
      },
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.trash });
    qc.invalidateQueries({ queryKey: ['series'] });
    qc.invalidateQueries({ queryKey: ['episodes'] });
  };
}

export function useRestore() {
  const refresh = useInvalidateAll();
  return useMutation({
    mutationFn: async (item: TrashItem) =>
      item.kind === 'series'
        ? api.POST('/api/series/{series_id}/restore', { params: { path: { series_id: item.id } } })
        : api.POST('/api/episodes/{episode_id}/restore', {
            params: { path: { episode_id: item.id } },
          }),
    onSuccess: refresh,
  });
}

export function usePurge() {
  const refresh = useInvalidateAll();
  return useMutation({
    mutationFn: async (item: TrashItem) =>
      api.DELETE('/api/trash/{kind}/{item_id}', {
        params: { path: { kind: item.kind, item_id: item.id } },
      }),
    onSuccess: refresh,
  });
}

export function useImportBundle() {
  const refresh = useInvalidateAll();
  return useMutation({
    mutationFn: async (file: Blob) =>
      (await raw('/api/bundles', { method: 'POST', body: file })).json() as Promise<{
        series_id: string;
        episodes: number;
        renamed: boolean;
        bad_assets: string[];
      }>,
    onSuccess: refresh,
  });
}

export function useLegacyScan(enabled: boolean) {
  return useQuery({
    queryKey: ['legacy-scan'],
    enabled,
    retry: false,
    queryFn: async () =>
      data(await api.GET('/api/legacy/scan')) as unknown as Record<string, number>,
  });
}

export function useLegacyImport() {
  const refresh = useInvalidateAll();
  return useMutation({
    mutationFn: async (overwrite: boolean) =>
      data(
        await api.POST('/api/legacy/import', { body: { overwrite, root: null } }),
      ) as unknown as Record<string, string[]>,
    onSuccess: refresh,
  });
}
