import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { raw } from './client';

export interface ReleaseInfo {
  tag: string;
  version: string;
  name: string;
  published_at: string;
  prerelease: boolean;
  notes: string;
  installable: boolean;
  unavailable_reason: string;
}

export interface UpdateState {
  current: string;
  dev_checkout: boolean;
  keys_configured: boolean;
  auto_check: boolean;
  last_check: { at: string; latest: string | null; available: boolean; source?: string } | null;
  pending: { version: string } | null;
  activity: { phase: string; error: string; received?: number; total?: number; version?: string };
}

interface ReleasePage {
  items: ReleaseInfo[];
  page: number;
  has_more: boolean;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await raw(`/api/update${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        }),
  });
  return response.json() as Promise<T>;
}

export function updateBusy(state?: UpdateState) {
  return Boolean(
    state && ['checking', 'preparing', 'downloading', 'staging'].includes(state.activity.phase),
  );
}

export function useVersionStatus() {
  const queries = useQueryClient();
  const result = useQuery({
    queryKey: ['version-update'],
    queryFn: () => request<UpdateState>(''),
    refetchInterval: (query) => (updateBusy(query.state.data) ? 800 : false),
    refetchOnWindowFocus: true,
  });
  const checkedAt = result.data?.last_check?.at;
  useEffect(() => {
    if (checkedAt) void queries.invalidateQueries({ queryKey: ['release-catalog'] });
  }, [checkedAt, queries]);
  return result;
}

export function useReleaseCatalog(page: number) {
  return useQuery({
    queryKey: ['release-catalog', page],
    queryFn: () => request<ReleasePage>(`/releases?page=${page}&per_page=12`),
    staleTime: 30_000,
  });
}

export function useVersionAction() {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (action: {
      type: 'check' | 'install' | 'download' | 'cancel' | 'preferences';
      tag?: string;
      auto_check?: boolean;
    }) => {
      if (action.type === 'check') return request<UpdateState>('/check?background=true', 'POST');
      if (action.type === 'install')
        return request<UpdateState>('/install', 'POST', { tag: action.tag });
      if (action.type === 'download')
        return request<UpdateState>('/download?background=true', 'POST');
      if (action.type === 'preferences')
        return request<UpdateState>('/preferences', 'PATCH', { auto_check: action.auto_check });
      return request<UpdateState>('/cancel', 'POST');
    },
    onSuccess: (state) => {
      queries.setQueryData(['version-update'], state);
      void queries.invalidateQueries({ queryKey: ['release-catalog'] });
    },
  });
}
