import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { raw } from './client';
import type { ExtensionInfo } from './open';

export interface MarketItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  tags: string[];
  source: 'bundled' | 'remote';
  package_url?: string;
  sha256?: string;
  installed: {
    version: string;
    status: ExtensionInfo['status'];
    digest: string;
    builtin: boolean;
  } | null;
  action: 'enable' | 'install' | 'update' | 'installed';
}
export interface MarketCatalog {
  source: { url: string; builtin: boolean; checked_at: string; error: string };
  catalog_digest: string;
  items: MarketItem[];
}
export const marketKey = ['extension-market'];
export function useExtensionMarket() {
  return useQuery({
    queryKey: marketKey,
    queryFn: async () => (await raw('/api/extension-market')).json() as Promise<MarketCatalog>,
    retry: false,
  });
}
export function useMarketAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input:
        | { action: 'refresh' }
        | { action: 'source'; url: string }
        | { action: 'install'; item: MarketItem; digest: string },
    ) => {
      if (input.action === 'refresh')
        return (await raw('/api/extension-market?refresh=true')).json() as Promise<MarketCatalog>;
      const path =
        input.action === 'source'
          ? '/api/extension-market/source'
          : `/api/extension-market/${encodeURIComponent(input.item.id)}/install`;
      return (
        await raw(path, {
          method: input.action === 'source' ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            input.action === 'source'
              ? { url: input.url }
              : { expected_catalog_digest: input.digest, expected_sha256: input.item.sha256 },
          ),
        })
      ).json() as Promise<MarketCatalog | ExtensionInfo>;
    },
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: marketKey }),
        qc.invalidateQueries({ queryKey: ['extensions'] }),
      ]),
  });
}
