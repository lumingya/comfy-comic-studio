import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePurge, useRestore, useTrash } from '../../api/system';
import type { TrashItem } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Empty, Loading, Modal } from '../../components/ui';

export default function TrashPage() {
  const { t } = useTranslation();
  const trash = useTrash();
  const restore = useRestore();
  const purge = usePurge();
  const [confirm, setConfirm] = useState<TrashItem | null>(null);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="overline">{t('nav.trash')}</div>
          <h1>{t('trash.heading')}</h1>
          {trash.data ? (
            <p className="muted">{t('trash.sub', { days: trash.data.retention_days })}</p>
          ) : null}
        </div>
      </header>
      {trash.isLoading ? <Loading /> : null}
      {trash.error ? <QueryError error={trash.error} /> : null}
      {trash.data && !trash.data.items.length ? <Empty>{t('trash.empty')}</Empty> : null}
      {trash.data?.items.length ? (
        <table className="table">
          <tbody>
            {trash.data.items.map((item) => (
              <tr key={`${item.kind}:${item.id}`}>
                <td>
                  <span className="chip">{t(`trash.kinds.${item.kind}`)}</span>
                </td>
                <td>
                  <strong>{item.title}</strong>
                  {item.series_title ? (
                    <div className="small muted">{item.series_title}</div>
                  ) : null}
                </td>
                <td className="small muted">
                  {item.deleted_at ? new Date(item.deleted_at).toLocaleString() : ''}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn sm"
                    onClick={() =>
                      restore.mutate(item, {
                        onSuccess: () => toast(t('trash.restored')),
                        onError: toastError,
                      })
                    }
                  >
                    <RotateCcw size={13} /> {t('trash.restore')}
                  </button>{' '}
                  <button className="btn ghost sm danger" onClick={() => setConfirm(item)}>
                    <Trash2 size={13} /> {t('trash.purge')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Modal
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('trash.purgeTitle', { title: confirm?.title ?? '' })}
        description={t('trash.purgeHint')}
        footer={
          <>
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn danger"
              disabled={purge.isPending}
              onClick={() =>
                confirm &&
                purge.mutate(confirm, { onSuccess: () => setConfirm(null), onError: toastError })
              }
            >
              {t('trash.purge')}
            </button>
          </>
        }
      >
        {null}
      </Modal>
    </div>
  );
}
