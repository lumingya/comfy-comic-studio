/** P5 surfaces: themes, extensions, cloud channels, API tokens, webhooks, updates, album. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, data, raw } from './client';

/** The same media contract is used by package backgrounds and private uploads. */
export interface MediaDescriptor {
  kind: 'image' | 'video';
  url: string;
  animated: boolean;
  mime_type: string;
}

export interface ThemeInfo {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  author: string;
  source: string;
  tokens: Record<string, string>;
  background?: (MediaDescriptor & { opacity: number }) | null;
  style_url?: string | null;
  script_url?: string | null;
  script_digest?: string | null;
  card_style_url?: string | null;
  settings_schema?: ThemeSettingField[];
  settings_page_url?: string | null;
}

export interface ThemeSettingField {
  id: string;
  type: 'slider' | 'switch' | 'select' | 'file_upload';
  label: string;
  description?: string;
  default?: string | number | boolean | null;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string | number | boolean }[];
  options_source?: 'wallpapers';
}

export interface ThemeWallpaper extends MediaDescriptor {
  id: string;
  filename: string;
}

export interface ThemeWallpapers {
  items: ThemeWallpaper[];
}

export interface FloatingPosition {
  x: 'left' | 'right' | number;
  y: 'top' | 'bottom' | number;
  offset: [number, number];
}

export interface ExtensionInfo {
  builtin?: boolean;
  has_data?: boolean;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  runs_code: boolean;
  has_python: boolean;
  has_requirements: boolean;
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

export function useImportThemePackage() {
  const done = useInvalidate(k.themes);
  return useMutation({
    mutationFn: async (file: Blob) =>
      (
        await raw('/api/themes/package', { method: 'POST', body: file })
      ).json() as Promise<ThemeInfo>,
    onSuccess: done,
  });
}

export function useImportThemeFolder() {
  const done = useInvalidate(k.themes);
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      files.forEach((file) => form.append('files', file, file.webkitRelativePath || file.name));
      return (
        await raw('/api/themes/folder', { method: 'POST', body: form })
      ).json() as Promise<ThemeInfo>;
    },
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

export function useThemePreferences(themeId: string | null) {
  return useQuery({
    queryKey: ['theme-preferences', themeId],
    enabled: !!themeId,
    queryFn: () =>
      json<Record<string, unknown>>(`/api/themes/${encodeURIComponent(themeId!)}/preferences`),
  });
}

export function useSaveThemePreferences(themeId: string) {
  const qc = useQueryClient();
  const queryKey = ['theme-preferences', themeId] as const;
  return useMutation({
    mutationFn: (preferences: Record<string, unknown>) =>
      json<Record<string, unknown>>(
        `/api/themes/${encodeURIComponent(themeId)}/preferences`,
        'PUT',
        preferences,
      ),
    onMutate: async (preferences) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Record<string, unknown>>(queryKey);
      qc.setQueryData(queryKey, { ...previous, ...preferences });
      return { previous };
    },
    onError: (_error, _preferences, context) => {
      if (context?.previous !== undefined) qc.setQueryData(queryKey, context.previous);
    },
    onSuccess: (preferences) => qc.setQueryData(queryKey, preferences),
  });
}

export function useThemeWallpapers(themeId: string | null) {
  return useQuery({
    queryKey: ['theme-wallpapers', themeId],
    enabled: !!themeId,
    queryFn: () => json<ThemeWallpapers>(`/api/themes/${encodeURIComponent(themeId!)}/wallpapers`),
  });
}

export function useUploadThemeWallpaper(themeId: string) {
  const qc = useQueryClient();
  const queryKey = ['theme-wallpapers', themeId] as const;
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file, file.name);
      return (
        await raw(`/api/themes/${encodeURIComponent(themeId)}/wallpapers`, {
          method: 'POST',
          body,
        })
      ).json() as Promise<ThemeWallpaper>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

export function useDeleteThemeWallpaper(themeId: string) {
  const done = useInvalidate(['theme-wallpapers', themeId]);
  return useMutation({
    mutationFn: (wallpaperId: string) =>
      json<void>(
        `/api/themes/${encodeURIComponent(themeId)}/wallpapers/${encodeURIComponent(wallpaperId)}`,
        'DELETE',
      ),
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
  const done = useInvalidate(
    k.extensions,
    k.themes,
    k.albumTemplates,
    ['registry'],
    ['extension-surfaces'],
    ['extension-market'],
  );
  return useMutation({
    mutationFn: async (
      input:
        | { id: string; action: 'remove'; deleteData: boolean }
        | { id: string; action: 'enable' | 'disable'; digest?: string },
    ) => {
      const { id, action } = input;
      if (action === 'remove')
        return json(
          `/api/extensions/${encodeURIComponent(id)}?delete_data=${input.deleteData}`,
          'DELETE',
        );
      const info = await json<ExtensionInfo>(
        `/api/extensions/${encodeURIComponent(id)}/${action}`,
        'POST',
        {
          digest: input.digest,
        },
      );
      if (action === 'enable' && (info.error || info.status !== 'active')) {
        await done();
        throw new Error(info.error || info.status);
      }
      return info;
    },
    onSuccess: done,
  });
}

export function useInstallExtension() {
  const done = useInvalidate(k.extensions);
  return useMutation({
    mutationFn: async (input: { replace: boolean } & ({ file: Blob } | { files: File[] })) => {
      let body: Blob | FormData;
      let path = '/api/extensions';
      if ('files' in input) {
        const form = new FormData();
        input.files.forEach((file) => form.append('files', file, file.webkitRelativePath));
        body = form;
        path += '/folder';
      } else body = input.file;
      return (
        await raw(`${path}?replace=${input.replace}`, { method: 'POST', body })
      ).json() as Promise<ExtensionInfo>;
    },
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

/** A full album template document (GET /api/album-templates/{id}; the legacy file format). */
export interface AlbumTemplateDoc {
  id: string;
  formatVersion?: 1;
  title: string;
  description: string;
  author: string;
  version: string;
  layout: 'webtoon' | 'manga' | 'artbook' | 'flip';
  options: {
    accent: string;
    background: string;
    paper: string;
    text: string;
    width: number;
    gap: number;
    radius: number;
    font: 'serif' | 'sans';
  };
  html: string;
  assets: Record<string, string>;
}

export function useAlbumTemplate(id: string | null) {
  return useQuery({
    queryKey: [...k.albumTemplates, id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: () => json<AlbumTemplateDoc>(`/api/album-templates/${encodeURIComponent(id!)}`),
  });
}

export function useDeleteAlbumTemplate() {
  const done = useInvalidate(k.albumTemplates);
  return useMutation({
    mutationFn: (id: string) =>
      json<void>(`/api/album-templates/${encodeURIComponent(id)}`, 'DELETE'),
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
  activation?: string;
  digest?: string;
  requests?: PanelRequest[];
}

export interface PanelRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  scope: 'read' | 'write' | 'render' | 'admin';
}

export function useExtensionPanels(slot: ExtensionPanel['slot']) {
  return useQuery({
    queryKey: [...k.extensions, 'panels'],
    staleTime: 30_000,
    queryFn: () => json<ExtensionPanel[]>('/api/extension-panels'),
    select: (panels) => panels.filter((p) => p.slot === slot),
  });
}
