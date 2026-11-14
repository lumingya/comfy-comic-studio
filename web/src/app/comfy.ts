import { useQueries } from '@tanstack/react-query';
import { api, data } from '../api/client';
import { useInstances } from '../api/system';

export type ComfyState = 'checking' | 'online' | 'offline' | 'unset';

/** Check only eligible instances. Any reachable instance is sufficient for this profile. */
export function useComfyHealth(
  instanceIds: readonly string[] = [],
  enabled = true,
): {
  state: ComfyState;
  name: string;
  detail: string;
  url: string;
} {
  const instances = useInstances();
  const allowed = (instances.data?.instances ?? []).filter(
    (instance) => instance.enabled && (!instanceIds.length || instanceIds.includes(instance.id)),
  );
  const health = useQueries({
    queries: allowed.map((instance) => ({
      queryKey: ['comfy-health', instance.id],
      enabled,
      refetchInterval: enabled ? 20_000 : (false as const),
      retry: false,
      queryFn: async () =>
        data(
          await api.GET('/api/instances/{instance_id}/health', {
            params: { path: { instance_id: instance.id } },
          }),
        ) as unknown as { ok: boolean; stats: Record<string, unknown> },
    })),
  });
  const empty = { name: 'ComfyUI', detail: '', url: '' };
  if (!enabled) return { ...empty, state: 'unset' };
  if (instances.isError) return { ...empty, state: 'offline' };
  if (instances.isLoading) return { ...empty, state: 'checking' };
  if (!allowed.length) return { ...empty, state: 'unset' };
  const online = health.findIndex((query) => query.data?.ok);
  const current = allowed[online < 0 ? 0 : online];
  const error = health[0]?.data?.stats?.error;
  return {
    state:
      online >= 0 ? 'online' : health.some((query) => query.isPending) ? 'checking' : 'offline',
    name: current.name,
    detail: typeof error === 'string' && online < 0 ? error : current.base_url,
    url: current.base_url,
  };
}
