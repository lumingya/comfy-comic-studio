import { useQuery } from '@tanstack/react-query';
import { api, data } from '../api/client';
import { useInstances } from '../api/system';

export type ComfyState = 'checking' | 'online' | 'offline' | 'unset';

/**
 * Is the first enabled ComfyUI instance reachable?  Polled quietly so the top bar pill and the
 * generate stage can tell a newcomer *why* nothing renders (legacy 「ComfyUI · 未连接」).
 */
export function useComfyHealth(): { state: ComfyState; name: string; detail: string } {
  const instances = useInstances();
  const first = (instances.data?.instances ?? []).find((i) => i.enabled);
  const health = useQuery({
    queryKey: ['comfy-health', first?.id ?? ''],
    enabled: !!first,
    refetchInterval: 20_000,
    retry: false,
    queryFn: async () =>
      data(
        await api.GET('/api/instances/{instance_id}/health', {
          params: { path: { instance_id: first!.id } },
        }),
      ) as unknown as { ok: boolean; stats: Record<string, unknown> },
  });
  if (instances.isError) return { state: 'offline', name: 'ComfyUI', detail: '' };
  if (instances.isLoading) return { state: 'checking', name: 'ComfyUI', detail: '' };
  if (!first) return { state: 'unset', name: 'ComfyUI', detail: '' };
  const detail = first.base_url;
  if (health.isLoading) return { state: 'checking', name: first.name, detail };
  const error = health.data?.stats?.error;
  return {
    state: health.data?.ok ? 'online' : 'offline',
    name: first.name,
    detail: typeof error === 'string' ? error : detail,
  };
}
