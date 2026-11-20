import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import type { ContextGroup } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import type { useBulkActions } from './BulkBar';
import { missingOf, useResumeSeries } from './shelf';

type WorksActions = {
  books: SeriesCard[];
  generating: Set<string>;
  bulkActions: ReturnType<typeof useBulkActions>;
  setRenaming: (books: SeriesCard[]) => void;
  setExporting: (books: SeriesCard[]) => void;
  setCoverFor: (id: string) => void;
  setBulkMode: (on: boolean) => void;
  onExport: (id: string) => void;
};

/** Album actions share the same target selection and explicit task submission. */
export function useWorksActions({
  books,
  generating,
  bulkActions,
  setRenaming,
  setExporting,
  setCoverFor,
  setBulkMode,
  onExport,
}: WorksActions) {
  const { t } = useTranslation();
  const resumeSeries = useResumeSeries();
  const [resuming, setResuming] = useState<string[]>([]);
  const resume = async (targets: SeriesCard[]) => {
    const todo = targets.filter((b) => missingOf(b) > 0 && !generating.has(b.id!));
    if (!todo.length) {
      toast(
        t(
          targets.some((b) => generating.has(b.id!))
            ? 'classic.shelf.resumeBusy'
            : 'classic.shelf.resumeNone',
        ),
      );
      return;
    }
    const ids = todo.map((b) => b.id!);
    setResuming((r) => [...r, ...ids]);
    let queued = 0;
    try {
      for (const b of todo) queued += await resumeSeries(b);
      toast(queued ? t('classic.shelf.resumed', { count: queued }) : t('classic.shelf.resumeNone'));
    } catch (e) {
      toastError(e);
    } finally {
      setResuming((r) => r.filter((id) => !ids.includes(id)));
    }
  };
  /** Everyday album actions; export choices live in the export screen. */
  const shelfMenu = (ids: string[]): ContextGroup[] => {
    const targets = books.filter((b) => ids.includes(b.id!));
    const starredAll = bulkActions.allStarred(targets);
    if (targets.length > 1) {
      return [
        {
          heading: t('classic.shelf.forSelection', { count: targets.length }),
          items: [
            {
              label: t(starredAll ? 'classic.shelf.unstarMany' : 'classic.shelf.starMany'),
              icon: <Icon name="star" sm />,
              onSelect: () => bulkActions.star(targets),
            },
            {
              label: t('classic.shelf.renameMulti'),
              icon: <Icon name="edit" sm />,
              onSelect: () => setRenaming(targets),
            },
            {
              label: t('common.export'),
              icon: <Icon name="download" sm />,
              onSelect: () => setExporting(targets),
            },
            ...(targets.some((b) => missingOf(b) > 0)
              ? [
                  {
                    label: t('classic.shelf.resumeMenu'),
                    icon: <Icon name="refresh" sm />,
                    hint: t('classic.shelf.resumeMultiHint'),
                    onSelect: () => void resume(targets),
                  },
                ]
              : []),
          ],
        },
        {
          items: [
            {
              label: t('classic.shelf.clearSelection'),
              icon: <Icon name="close" sm />,
              shortcut: 'Esc',
              onSelect: () => setBulkMode(false),
            },
          ],
        },
        {
          items: [
            {
              label: t('classic.shelf.deleteMany'),
              icon: <Icon name="trash" sm />,
              danger: true,
              shortcut: 'Del',
              disabled: bulkActions.busy,
              onSelect: () => void bulkActions.remove(targets),
            },
          ],
        },
      ];
    }
    const one = targets[0];
    if (!one) return [];
    const id = one.id!,
      missing = missingOf(one),
      busy = generating.has(id);
    return [
      {
        items: [
          {
            label: starredAll ? t('classic.shelf.unstar') : t('classic.shelf.star'),
            icon: <Icon name="star" sm />,
            onSelect: () => bulkActions.star(targets),
          },
          {
            label: t('classic.shelf.renameMenu'),
            icon: <Icon name="edit" sm />,
            onSelect: () => setRenaming(targets),
          },
          ...(missing > 0
            ? [
                {
                  label: t('classic.shelf.resumeMenu'),
                  icon: <Icon name="refresh" sm />,
                  disabled: busy || resuming.includes(id),
                  hint: busy
                    ? t('classic.shelf.resumeBusy')
                    : t('classic.shelf.resumeHint', { count: missing }),
                  onSelect: () => void resume(targets),
                },
              ]
            : []),
          {
            label: t('classic.shelf.changeCover'),
            icon: <Icon name="image" sm />,
            onSelect: () => setCoverFor(id),
          },
        ],
      },
      {
        items: [
          {
            label: t('common.export'),
            icon: <Icon name="download" sm />,
            onSelect: () => onExport(id),
          },
        ],
      },
      {
        items: [
          {
            label: t('classic.shelf.deleteOne'),
            icon: <Icon name="trash" sm />,
            danger: true,
            shortcut: 'Del',
            disabled: bulkActions.busy,
            onSelect: () => void bulkActions.remove(targets),
          },
        ],
      },
    ];
  };
  /** Legacy ctx-title / subtitle: the album and its facts, or the size of the selection. */
  const menuHead = (ids: string[]) => {
    if (ids.length > 1)
      return {
        title: t('classic.shelf.selectedTitle', { count: ids.length }),
        subtitle: t('classic.shelf.multiSubtitle'),
      };
    const one = books.find((b) => b.id === ids[0]);
    if (!one) return {};
    const missing = missingOf(one);
    const cast = (one.bible?.characters ?? [])
      .map((c) => c.name)
      .filter(Boolean)
      .slice(0, 2)
      .join('、');
    return {
      title: one.title,
      subtitle: [
        t('classic.shelf.frames', { count: one.panel_count ?? 0 }),
        cast,
        missing ? t('classic.shelf.missingShort', { count: missing }) : t('classic.shelf.ready'),
      ]
        .filter(Boolean)
        .join(' · '),
    };
  };

  return { resuming, resume, shelfMenu, menuHead };
}
