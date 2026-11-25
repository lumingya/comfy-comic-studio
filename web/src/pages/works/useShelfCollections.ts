import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  assignCollections,
  collectionsKey,
  createCollection,
  deleteCollection,
  renameCollection,
  useCollectionsIndex,
  type CollectionAssignment,
  type CollectionsIndex,
} from '../../api/collections';
import type { SeriesCard } from '../../api/types';
import { ApiError } from '../../api/client';
import { toast, toastError } from '../../components/toast';

/** Collection and status/search filters intersect; the incoming shelf order stays untouched. */
export function booksInCollection(
  books: SeriesCard[],
  value: string,
  index: CollectionsIndex | undefined,
): SeriesCard[] {
  if (!value) return books;
  if (!index) return [];
  const target = value === 'unfiled' ? null : value;
  return books.filter((book) => index.memberships[book.id!]?.collection_id === target);
}

export function useShelfCollections(items: SeriesCard[], value: string, onMissing: () => void) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useCollectionsIndex();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const albumKey = items
    .map((book) => book.id)
    .sort()
    .join(',');
  const previousAlbums = useRef(albumKey);
  useEffect(() => {
    if (previousAlbums.current === albumKey) return;
    previousAlbums.current = albumKey;
    void qc.invalidateQueries({ queryKey: collectionsKey });
  }, [albumKey, qc]);
  useEffect(() => {
    if (
      query.data &&
      value &&
      value !== 'unfiled' &&
      !query.data.collections.some((c) => c.id === value)
    )
      onMissing();
  }, [query.data, value, onMissing]);

  const refresh = () => qc.invalidateQueries({ queryKey: collectionsKey });
  const report = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409)
      toastError(
        new Error(t('works.collections.conflict', { defaultValue: '归类已发生变化，请重试。' })),
      );
    else toastError(error);
  };
  const apply = async (assignments: CollectionAssignment[]) => {
    const result = await assignCollections(assignments);
    // No optimistic filtering: a failed batch never makes books disappear from this shelf.
    await qc.cancelQueries({ queryKey: collectionsKey });
    qc.setQueryData(collectionsKey, result.index);
    return result;
  };
  const move = async (ids: string[], collectionId: string | null) => {
    if (locked.current || !ids.length) return;
    const current = qc.getQueryData<CollectionsIndex>(collectionsKey);
    if (!current || ids.some((id) => !current.memberships[id])) {
      await refresh();
      return;
    }
    const assignments = [...new Set(ids)]
      .filter((id) => current.memberships[id].collection_id !== collectionId)
      .map((id) => ({
        series_id: id,
        collection_id: collectionId,
        expected_revision: current.memberships[id].revision,
      }));
    if (!assignments.length) return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await apply(assignments);
      if (!result.changes.length) return;
      toast(
        t('works.collections.moved', {
          count: result.changes.length,
          defaultValue: '已归类 {{count}} 本画册',
        }),
        {
          action: {
            label: t('common.undo'),
            onClick: () => {
              if (locked.current) return;
              locked.current = true;
              setBusy(true);
              // Compare against each successful write, including revision, so undo cannot clobber
              // a later move from this shelf, another window, or an external client.
              void apply(
                result.changes.map((change) => ({
                  series_id: change.series_id,
                  collection_id: change.before.collection_id,
                  expected_revision: change.after.revision,
                })),
              )
                .catch((error) => {
                  report(error);
                  void refresh();
                })
                .finally(() => {
                  locked.current = false;
                  setBusy(false);
                });
            },
          },
        },
      );
    } catch (error) {
      report(error);
      void refresh();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return {
    query,
    busy,
    move,
    create: async (name: string) => {
      const result = await createCollection(name);
      await refresh();
      return result;
    },
    rename: async (id: string, name: string) => {
      const result = await renameCollection(id, name);
      await refresh();
      return result;
    },
    remove: async (id: string) => {
      await deleteCollection(id);
      await refresh();
    },
  };
}
