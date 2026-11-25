import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionsKey, type CollectionsIndex } from '../../api/collections';
import type { SeriesCard } from '../../api/types';
import { useToasts } from '../../components/toast';
import { mockFetch } from '../../test/utils';
import { booksInCollection, useShelfCollections } from './useShelfCollections';

const books = ['a', 'b', 'c'].map((id) => ({ id, title: id }) as SeriesCard);
const initial = (): CollectionsIndex => ({
  collections: [
    { id: 'shorts', name: '短篇', created_at: '', updated_at: '', album_count: 1 },
    { id: 'longs', name: '长篇', created_at: '', updated_at: '', album_count: 0 },
  ],
  memberships: {
    a: { collection_id: null, revision: 0 },
    b: { collection_id: 'shorts', revision: 3 },
    c: { collection_id: null, revision: 2 },
  },
  total_count: 3,
  unfiled_count: 2,
});
function setup(routes: Parameters<typeof mockFetch>[0] = {}, value = '') {
  const calls = mockFetch({ 'GET /api/collections': initial(), ...routes });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onMissing = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useShelfCollections(books, value, onMissing), { wrapper });
  return { ...hook, client, calls, onMissing };
}
afterEach(() => {
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

describe('shelf collection persistence', () => {
  it('intersects filters without changing the displayed order; missing memberships are never unfiled', () => {
    const index = initial();
    expect(booksInCollection([...books].reverse(), 'unfiled', index).map((b) => b.id)).toEqual([
      'c',
      'a',
    ]);
    expect(booksInCollection(books, 'shorts', index).map((b) => b.id)).toEqual(['b']);
    expect(booksInCollection(books, '', undefined)).toBe(books);
    expect(booksInCollection(books, 'unfiled', undefined)).toEqual([]);
    delete index.memberships.a;
    expect(booksInCollection(books, 'unfiled', index).map((b) => b.id)).toEqual(['c']);
  });

  it('writes one stable deduplicated batch and undo compares the successful revisions', async () => {
    const moved = initial();
    moved.memberships.a = { collection_id: 'shorts', revision: 1 };
    moved.memberships.c = { collection_id: 'shorts', revision: 3 };
    let requests = 0;
    const { result, calls } = setup({
      'POST /api/collections/memberships': () =>
        ++requests === 1
          ? {
              changes: ['a', 'c'].map((id) => ({
                series_id: id,
                before: initial().memberships[id],
                after: moved.memberships[id],
              })),
              index: moved,
            }
          : { changes: [], index: initial() },
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    await act(() => result.current.move(['a', 'c', 'a', 'b'], 'shorts'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      assignments: [
        { series_id: 'a', collection_id: 'shorts', expected_revision: 0 },
        { series_id: 'c', collection_id: 'shorts', expected_revision: 2 },
      ],
    });
    expect(result.current.query.data?.memberships.a.collection_id).toBe('shorts');
    act(() => useToasts.getState().items.at(-1)?.action?.onClick());
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({
      assignments: [
        { series_id: 'a', collection_id: null, expected_revision: 1 },
        { series_id: 'c', collection_id: null, expected_revision: 3 },
      ],
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('keeps the shelf and selection source intact until a failed server batch has settled', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_, fail) => {
      reject = fail;
    });
    const { result, client } = setup({ 'POST /api/collections/memberships': () => pending });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    let task!: Promise<void>;
    act(() => {
      task = result.current.move(['a'], 'shorts');
    });
    expect(result.current.busy).toBe(true);
    expect(
      client.getQueryData<CollectionsIndex>(collectionsKey)?.memberships.a.collection_id,
    ).toBeNull();
    await act(async () => {
      reject(new Error('offline'));
      await task;
    });
    expect(result.current.query.data?.memberships.a.collection_id).toBeNull();
    expect(useToasts.getState().items.at(-1)?.text).toBe('offline');
    expect(useToasts.getState().items.some((item) => item.action)).toBe(false);
  });

  it('refuses stale undo atomically and refreshes instead of overwriting a later move', async () => {
    const moved = initial();
    moved.memberships.a = { collection_id: 'shorts', revision: 1 };
    const newer = initial();
    newer.memberships.a = { collection_id: 'longs', revision: 2 };
    let posts = 0;
    const { result, client, calls } = setup({
      'GET /api/collections': () => (posts > 1 ? newer : initial()),
      'POST /api/collections/memberships': () =>
        ++posts === 1
          ? {
              changes: [
                { series_id: 'a', before: initial().memberships.a, after: moved.memberships.a },
              ],
              index: moved,
            }
          : new Response(JSON.stringify({ detail: 'conflict' }), { status: 409 }),
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    await act(() => result.current.move(['a'], 'shorts'));
    client.setQueryData(collectionsKey, newer);
    act(() =>
      useToasts
        .getState()
        .items.find((item) => item.action)
        ?.action?.onClick(),
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(calls.filter((c) => c.method === 'POST')[1].body).toEqual({
      assignments: [{ series_id: 'a', collection_id: null, expected_revision: 1 }],
    });
    expect(result.current.query.data?.memberships.a).toEqual({
      collection_id: 'longs',
      revision: 2,
    });
    expect(useToasts.getState().items.at(-1)?.kind).toBe('error');
  });

  it('clears only a confirmed missing collection; failed or loading indexes do not reset the URL', async () => {
    const { result, onMissing } = setup({}, 'gone');
    expect(onMissing).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(onMissing).toHaveBeenCalled();
  });
});
