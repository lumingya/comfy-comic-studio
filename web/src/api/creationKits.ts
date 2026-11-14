import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, data, downloadPost, raw } from './client';
import { keys } from './keys';
import type { components } from './schema';

export type KitInspection = components['schemas']['KitInspection'];
export type KitImport = components['schemas']['KitImport'];
export type KitAssembly = components['schemas']['KitAssembly'];
export type ProfileDestination = components['schemas']['ProfileDestination'];
export const creationKitsKey = ['creation-kits'] as const;
export const MAX_KIT_BYTES = 64 * 1024 * 1024;

export function useCreationKits() {
  return useQuery({
    queryKey: creationKitsKey,
    queryFn: async () => data(await api.GET('/api/creation-kits')),
  });
}

export async function inspectCreationKit(file: File, signal?: AbortSignal): Promise<KitInspection> {
  return (await raw('/api/creation-kits/inspect', { method: 'POST', body: file, signal })).json();
}

/** Keep the archive opaque; extraction and reference validation belong to the server. */
export function kitBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read archive'));
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.readAsDataURL(file);
  });
}

export function useImportCreationKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: KitImport) =>
      data(await api.POST('/api/creation-kits/import', { body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: creationKitsKey });
      qc.invalidateQueries({ queryKey: keys.profiles });
      qc.invalidateQueries({ queryKey: keys.workflows });
    },
  });
}

export function exportCreationKit(body: components['schemas']['KitSelection']) {
  return downloadPost(
    '/api/creation-kits/export',
    body,
    `${body.title || 'creation-kit'}.mio-kit.zip`,
  );
}
