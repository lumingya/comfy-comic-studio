import { RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePurge, useRestore, useTrash } from '../../api/system';
import type { TrashItem } from '../../api/types';
import { QueryError } from '../../app/errors';
import { relativeTime } from '../../app/format';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Empty, Loading } from '../../components/ui';

/** 回收站, shown under 设置 › 数据与备份. */
export function TrashSection() {
  const { t, i18n } = useTranslation();
  const trash = useTrash();
  const restore = useRestore();
  const purge = usePurge();

  const purgeItem = async (item: TrashItem) => {
    const ok = await confirm({
      title: t('trash.purgeTitle', { title: item.title }),
      description: t('trash.purgeHint'),
      confirmLabel: t('trash.purge'),
      danger: true,
    });
    if (ok) purge.mutate(item, { onError: toastError });
  };

  return (
    <div className="trash-section">
      {trash.data ? (
        <p className="small muted">{t('trash.sub', { days: trash.data.retention_days })}</p>
      ) : null}
      {trash.isLoading ? <Loading /> : null}
      {trash.error ? <QueryError error={trash.error} onRetry={trash.refetch} /> : null}
      {trash.data && !trash.data.items.length ? (
        <Empty icon={<Trash2 size={24} />} title={t('trash.empty')} />
      ) : null}
      {trash.data?.items.length ? (
        <div className="card flat">
          <table className="table">
            <tbody>
              {trash.data.items.map((item) => (
                <tr key={`${item.kind}:${item.id}`}>
                  <td style={{ width: 1 }}>
                    <span className="chip">{t(`trash.kinds.${item.kind}`)}</span>
                  </td>
                  <td>
                    <strong>{item.title}</strong>
                    {item.series_title ? (
                      <div className="small muted">{item.series_title}</div>
                    ) : null}
                  </td>
                  <td className="small muted" title={item.deleted_at ?? ''}>
                    {relativeTime(item.deleted_at, i18n.language)}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn sm"
                      disabled={restore.isPending}
                      onClick={() =>
                        restore.mutate(item, {
                          onSuccess: () => toast(t('trash.restored')),
                          onError: toastError,
                        })
                      }
                    >
                      <RotateCcw size={13} /> {t('trash.restore')}
                    </button>{' '}
                    <button
                      className="btn ghost sm danger"
                      disabled={purge.isPending || restore.isPending}
                      onClick={() => purgeItem(item)}
                    >
                      <Trash2 size={13} /> {t('trash.purge')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
