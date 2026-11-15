import { api, data } from './client';

export interface ModelCatalogRequest {
  kind: string;
  base_url: string;
  api_key: string;
  channel_id?: string;
}

export interface CatalogModel {
  id: string;
  name?: string;
  group?: string;
}

export interface ModelCatalogResponse {
  models: CatalogModel[];
  source: 'remote' | 'bundled';
  notice?: string;
}

/** A draft can be inspected without saving it or starting a generation. */
export async function fetchModelCatalog(
  request: ModelCatalogRequest,
  signal?: AbortSignal,
): Promise<ModelCatalogResponse> {
  return data(await api.POST('/api/settings/models', { body: request, signal }));
}
