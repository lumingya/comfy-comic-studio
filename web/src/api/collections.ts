import { useQuery } from '@tanstack/react-query';
import { raw } from './client';

export interface Collection {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  album_count: number;
}

export interface CollectionMembership {
  collection_id: string | null;
  revision: number;
}

export interface CollectionsIndex {
  collections: Collection[];
  memberships: Record<string, CollectionMembership>;
  total_count: number;
  unfiled_count: number;
}

export interface CollectionAssignment {
  series_id: string;
  collection_id: string | null;
  expected_revision: number;
}

export interface CollectionChange {
  series_id: string;
  before: CollectionMembership;
  after: CollectionMembership;
}

export interface MembershipResult {
  changes: CollectionChange[];
  index: CollectionsIndex;
}

export const collectionsKey = ['collections'] as const;

export function useCollectionsIndex() {
  return useQuery({
    queryKey: collectionsKey,
    queryFn: async (): Promise<CollectionsIndex> => (await raw('/api/collections')).json(),
  });
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function createCollection(name: string): Promise<Collection> {
  return (await raw('/api/collections', json('POST', { name }))).json();
}

export async function renameCollection(id: string, name: string): Promise<Collection> {
  return (await raw(`/api/collections/${encodeURIComponent(id)}`, json('PATCH', { name }))).json();
}

export async function deleteCollection(id: string): Promise<void> {
  await raw(`/api/collections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function assignCollections(
  assignments: CollectionAssignment[],
): Promise<MembershipResult> {
  return (await raw('/api/collections/memberships', json('POST', { assignments }))).json();
}
