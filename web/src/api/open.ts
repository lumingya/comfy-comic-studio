/** P5 surfaces: themes, extensions, cloud channels, API tokens, webhooks, updates, album. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data, raw } from './client';

export interface ThemeInfo {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  author: string;
  source: string;
  tokens: Record<string, string>;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  runs_code: boolean;
  has_python: boolean;
  panels: { id: string; slot: string; title: string }[];
  digest: string;
  status: 'active' | 'error' | 'changed' | 'disabled' | 'invalid';
  error: string;
  restart_required: boolean;
  contributions: string[];
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  scopes: string[];
  hint: string;
  created_at: string;
  expires_at: string;
  last_used_at: string;
  token?: string;
}

export interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  created_at: string;
}

export interface Delivery {
  id: string;
  event: string;
  at: string;
  status: number | null;
  attempts?: number;
  error: string;
}

export interface UpdateStatus {
  current: string;
  dev_checkout: boolean;
  keys_configured: boolean;
  releases_page: string;
  last_check: {
    at: string;
    latest: string;
    available: boolean;
    notes: string;
    size: number;
  } | null;
  pending: { version: string } | null;
}

export interface AlbumTemplateInfo {
  id: string;
  title: string;
  description: string;
  author: string;
  layout: string;
  layout_name: string;
  options: { accent: string; background: string; paper: string; text: string };
  source: string;
}

const k = {
  themes: ['themes'] as const,
  extensions: ['extensions'] as const,
  tokens: ['api-tokens'] as const,
  webhooks: ['webhooks'] as const,
  deliveries: (id: string) => ['webhook-deliveries', id] as const,
  update: ['update'] as const,
  albumTemplates: ['album-templates'] as const,
};

/** Untyped JSON call for endpoints whose schema is a free-form dict. */
async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const response = await raw(path, init);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

function useInvalidate(...queryKeys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return () => queryKeys.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
}

// ------------------------------------------------------------------ themes
export function useThemes() {
  return useQuery({
    queryKey: k.themes,
    staleTime: 60_000,
    queryFn: async () => data(await api.GET('/api/themes')) as unknown as ThemeInfo[],
  });
}

export function useImportTheme() {
  const done = useInvalidate(k.themes);
  return useMutation({
    mutationFn: (theme: unknown) => json<ThemeInfo>('/api/themes', 'POST', theme),
    onSuccess: done,
  });
}

export function useDeleteTheme() {
  const done = useInvalidate(k.themes);
  return useMutation({
    mutationFn: (id: string) => json(`/api/themes/${encodeURIComponent(id)}`, 'DELETE'),
    onSuccess: done,
  });
}

// -------------------------------------------------------------- extensions
export function useExtensions() {
  return useQuery({
    queryKey: k.extensions,
    queryFn: () =>
      json<{ items: ExtensionInfo[]; hooks: { name: string; kind: string }[]; safe_mode: boolean }>(
        '/api/extensions',
      ),
  });
}

export function useExtensionAction() {
  const done = useInvalidate(k.extensions, k.themes, k.albumTemplates, ['registry']);
  return useMutation({
    mutationFn: ({ id, action, digest }: { id: string; action: string; digest?: string }) =>
      action === 'remove'
        ? json(`/api/extensions/${id}`, 'DELETE')
        : json<ExtensionInfo>(`/api/extensions/${id}/${action}`, 'POST', { digest }),
    onSuccess: done,
  });
}

export function useInstallExtension() {
  const done = useInvalidate(k.extensions);
  return useMutation({
    mutationFn: async ({ file, replace }: { file: Blob; replace: boolean }) =>
      (
        await raw(`/api/extensions?replace=${replace}`, { method: 'POST', body: file })
      ).json() as Promise<ExtensionInfo>,
    onSuccess: done,
  });
}

// ------------------------------------------------------------------ tokens
export function useTokens() {
  return useQuery({
    queryKey: k.tokens,
    queryFn: () => json<{ items: ApiTokenInfo[]; scopes: string[] }>('/api/tokens'),
  });
}

export function useCreateToken() {
  const done = useInvalidate(k.tokens);
  return useMutation({
    mutationFn: (body: { name: string; scopes: string[]; expires_at: string }) =>
      json<ApiTokenInfo>('/api/tokens', 'POST', body),
    onSuccess: done,
  });
}

export function useRevokeToken() {
  const done = useInvalidate(k.tokens);
  return useMutation({
    mutationFn: (id: string) => json(`/api/tokens/${id}`, 'DELETE'),
    onSuccess: done,
  });
}

// ---------------------------------------------------------------- webhooks
export function useWebhooks() {
  return useQuery({
    queryKey: k.webhooks,
    queryFn: () => json<{ items: WebhookInfo[]; events: Record<string, string> }>('/api/webhooks'),
  });
}

export function useSaveWebhook() {
  const done = useInvalidate(k.webhooks);
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id
        ? json<WebhookInfo>(`/api/webhooks/${id}`, 'PATCH', body)
        : json<WebhookInfo>('/api/webhooks', 'POST', body),
    onSuccess: done,
  });
}

export function useDeleteWebhook() {
  const done = useInvalidate(k.webhooks);
  return useMutation({
    mutationFn: (id: string) => json(`/api/webhooks/${id}`, 'DELETE'),
    onSuccess: done,
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => json<Delivery>(`/api/webhooks/${id}/test`, 'POST'),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: k.deliveries(id) }),
  });
}

export function useDeliveries(id: string | null) {
  return useQuery({
    queryKey: k.deliveries(id ?? ''),
    enabled: !!id,
    queryFn: () => json<Delivery[]>(`/api/webhooks/${id}/deliveries`),
  });
}

// ----------------------------------------------------------------- updates
export function useUpdateStatus() {
  return useQuery({ queryKey: k.update, queryFn: () => json<UpdateStatus>('/api/update') });
}

export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: 'check' | 'download') => json<UpdateStatus>(`/api/update/${step}`, 'POST'),
    onSuccess: (status) => qc.setQueryData(k.update, status),
  });
}

// ------------------------------------------------------------------- album
export function useAlbumTemplates() {
  return useQuery({
    queryKey: k.albumTemplates,
    staleTime: 60_000,
    queryFn: () => json<AlbumTemplateInfo[]>('/api/album-templates'),
  });
}

export function useImportAlbumTemplate() {
  const done = useInvalidate(k.albumTemplates);
  return useMutation({
    mutationFn: (tpl: unknown) => json<AlbumTemplateInfo>('/api/album-templates', 'POST', tpl),
    onSuccess: done,
  });
}

// ------------------------------------------------------- extension panels
export interface ExtensionPanel {
  extension: string;
  id: string;
  slot: 'episode' | 'settings';
  title: string;
  url: string;
}

export function useExtensionPanels(slot: ExtensionPanel['slot']) {
  return useQuery({
    queryKey: [...k.extensions, 'panels'],
    staleTime: 30_000,
    queryFn: () => json<ExtensionPanel[]>('/api/extension-panels'),
    select: (panels) => panels.filter((p) => p.slot === slot),
  });
}
