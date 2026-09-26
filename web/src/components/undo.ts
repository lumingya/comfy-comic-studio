import { useTranslation } from 'react-i18next';
import { useRestore } from '../api/system';
import { toast, toastError } from './toast';

/** After moving something to the trash: a toast with "Undo" (restores it right away). */
export function useUndoTrash() {
  const { t } = useTranslation();
  const restore = useRestore();
  return (kind: 'series' | 'episode', id: string, title: string) =>
    toast(t('trash.moved', { title }), {
      action: {
        label: t('common.undo'),
        onClick: () =>
          restore.mutate(
            { kind, id, title, deleted_at: null },
            { onSuccess: () => toast(t('trash.restored')), onError: toastError },
          ),
      },
    });
}
