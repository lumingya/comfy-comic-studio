import { useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrashSeries } from '../../api/series';
import { useRestore } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';

/**
 * Batch actions on shelf albums: star or move them all to the trash with one undo.
 * Shared by the status bar and the
 * right-click menu so labels and behaviour match.
 */
export function useBulkActions(onDeleted: () => void) {
  const { t } = useTranslation();
  const starred = useUI((s) => s.starred);
  const toggleStar = useUI((s) => s.toggleStar);
  const trash = useTrashSeries();
  const restore = useRestore();
  const [busy, setBusy] = useState(false);

  const allStarred = (books: SeriesCard[]) =>
    books.length > 0 && books.every((b) => starred.includes(b.id!));
  const star = (books: SeriesCard[]) => {
    // Star them all; when every one is already starred, unstar them instead.
    const off = allStarred(books);
    for (const b of books) if (starred.includes(b.id!) === off) toggleStar(b.id!);
    toast(
      t(off ? 'classic.shelf.bulkUnstarred' : 'classic.shelf.bulkStarred', {
        count: books.length,
      }),
    );
  };
  const remove = async (books: SeriesCard[]) => {
    if (!books.length) return;
    setBusy(true);
    const done: SeriesCard[] = [];
    try {
      for (const b of books) {
        await trash.mutateAsync(b.id!);
        done.push(b);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
    if (!done.length) return;
    onDeleted();
    toast(t('classic.shelf.bulkDeleted', { count: done.length }), {
      action: {
        label: t('common.undo'),
        onClick: () =>
          void Promise.all(
            done.map((b) =>
              restore.mutateAsync({ kind: 'series', id: b.id!, title: b.title, deleted_at: null }),
            ),
          )
            .then(() => toast(t('trash.restored')))
            .catch(toastError),
      },
    });
  };
  return { busy, allStarred, star, remove };
}

/** The selection status bar above the shelf grid. */
export function BulkBar(props: {
  books: SeriesCard[];
  chosen: SeriesCard[];
  actions: ReturnType<typeof useBulkActions>;
  onAll: () => void;
  onNone: () => void;
  onExit: () => void;
  pinned?: boolean;
  onMore: (event: MouseEvent<HTMLButtonElement>) => void;
  onExport: () => void;
  moveAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const { chosen, actions: a } = props;
  const n = chosen.length;
  const allSelected = n === props.books.length;
  const allStarred = a.allStarred(chosen);
  return (
    <div
      className="shelf-selection-status selection-status"
      role="toolbar"
      aria-label={t('classic.shelf.selectionLabel')}
    >
      <span className="selection-count" role="status" aria-live="polite">
        {t('classic.shelf.bulkSelected', { count: n })}
      </span>
      {props.pinned ? (
        <>
          <button
            type="button"
            className="selection-action"
            onClick={allSelected ? props.onNone : props.onAll}
          >
            {allSelected ? t('classic.shelf.bulkNone') : t('classic.shelf.bulkAll')}
          </button>
          <button
            type="button"
            className="selection-action"
            disabled={!n}
            onClick={() => a.star(chosen)}
          >
            <Icon name="star" sm />
            {allStarred ? t('classic.shelf.unstar') : t('classic.shelf.star')}
          </button>
        </>
      ) : null}
      {props.moveAction}
      <button
        type="button"
        className="selection-action"
        disabled={!n || a.busy}
        onClick={props.onExport}
      >
        <Icon name="download" sm />
        {t('common.export')}
      </button>
      <button
        type="button"
        className="selection-action danger"
        disabled={!n || a.busy}
        onClick={() => void a.remove(chosen)}
      >
        <Icon name="trash" sm />
        {t('classic.shelf.deleteMany')}
      </button>
      <button
        type="button"
        className="selection-action"
        disabled={!n}
        onClick={props.onMore}
        aria-haspopup="menu"
      >
        {t('classic.shelf.selectionMore')}
      </button>
      <span className="spacer" />
      <button
        type="button"
        className="ibtn"
        title={`${t('classic.shelf.clearSelection')} (Esc)`}
        aria-label={t('classic.shelf.clearSelection')}
        onClick={props.onExit}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
