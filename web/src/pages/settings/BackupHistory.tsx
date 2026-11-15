import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deleteWorkspaceBackup,
  deleteWorkspaceRestorePlan,
  getWorkspaceRestorePlan,
  listWorkspaceBackups,
  listWorkspaceRestorePlans,
  workspaceBackupDownloadUrl,
  type BackupRecord,
  type RestorePlan,
  type RestoreRecord,
} from '../../api/backups';
import { confirm } from '../../components/confirm';

export const backupHistoryKey = ['workspace-backup-history'] as const;
const pageSize = 20;

function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.ceil(bytes / 1024)} KiB`;
}

export function BackupHistory({
  onReview,
  onDeletedPlan,
}: {
  onReview: (plan: RestorePlan) => void;
  onDeletedPlan: (id: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'backups' | 'plans'>('backups');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: [...backupHistoryKey, kind, offset],
    queryFn: async () =>
      kind === 'backups'
        ? { kind: 'backups' as const, ...(await listWorkspaceBackups(offset, pageSize)) }
        : { kind: 'plans' as const, ...(await listWorkspaceRestorePlans(offset, pageSize)) },
    enabled: open,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: backupHistoryKey });
  const remove = async (record: BackupRecord | RestoreRecord) => {
    if (busy || !record.can_delete) return;
    const isPlan = 'state' in record;
    setBusy(true);
    setError(null);
    try {
      if (
        !(await confirm({
          title: t('workspaceBackups.deleteRecord', { id: record.id }),
          description: t(
            isPlan ? 'workspaceBackups.deletePlanHint' : 'workspaceBackups.deleteBackupHint',
            {
              size: sizeLabel(record.retained_bytes),
            },
          ),
          confirmLabel: t('common.delete'),
          danger: true,
        }))
      )
        return;
      if (isPlan) {
        await deleteWorkspaceRestorePlan(record.id);
        onDeletedPlan(record.id);
      } else await deleteWorkspaceBackup(record.id);
      if (query.data?.items.length === 1 && offset) setOffset(Math.max(0, offset - pageSize));
    } catch (cause) {
      setError(cause as Error);
    } finally {
      await refresh();
      setBusy(false);
    }
  };
  const review = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Catalog rows are only discovery. Fetch the current plan before opening its review flow.
      onReview(await getWorkspaceRestorePlan(id));
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  };
  const deletion = (record: BackupRecord | RestoreRecord) => (
    <button
      className="btn ghost sm danger"
      aria-label={t('workspaceBackups.deleteRecord', { id: record.id })}
      disabled={busy || !record.can_delete}
      onClick={() => void remove(record)}
    >
      <Trash2 size={14} />
      {t('common.delete')}
    </button>
  );
  return (
    <details style={{ marginTop: 20 }} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t('workspaceBackups.history')}</summary>
      <p className="small muted">{t('workspaceBackups.historyHint')}</p>
      <div className="row wrap" role="group" aria-label={t('workspaceBackups.history')}>
        {(['backups', 'plans'] as const).map((value) => (
          <button
            key={value}
            className={`btn sm ${kind === value ? '' : 'ghost'}`}
            aria-pressed={kind === value}
            disabled={busy}
            onClick={() => {
              setKind(value);
              setOffset(0);
              setError(null);
            }}
          >
            {t(
              value === 'backups' ? 'workspaceBackups.savedBackups' : 'workspaceBackups.savedPlans',
            )}
          </button>
        ))}
        <button
          className="btn ghost sm"
          disabled={busy || query.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          {t('common.refresh')}
        </button>
      </div>
      {error || query.error ? <p role="alert">{(error ?? query.error)?.message}</p> : null}
      {query.isPending && open ? <p role="status">{t('common.loading')}</p> : null}
      {query.data?.items.length === 0 ? <p className="small muted">{t('common.empty')}</p> : null}
      {query.data?.kind === 'backups'
        ? query.data.items.map((record) => (
            <div key={record.id} role="group" aria-label={record.id} style={{ marginTop: 18 }}>
              <p className="small" style={{ overflowWrap: 'anywhere' }}>
                {record.id} · {new Date(record.created_at).toLocaleString()}
              </p>
              <p className="small muted">
                {t('workspaceBackups.retainedSize', { size: sizeLabel(record.retained_bytes) })}
              </p>
              {record.includes_credentials ? (
                <p className="small notice warn">{t('workspaceBackups.withCredentials')}</p>
              ) : null}
              {record.protection_plan_ids.length ? (
                <p className="small muted">
                  {t('workspaceBackups.protectedByPlans', {
                    count: record.protection_plan_ids.length,
                  })}
                </p>
              ) : null}
              <div className="row wrap">
                <a className="btn ghost sm" href={workspaceBackupDownloadUrl(record.id)} download>
                  <Download size={14} />
                  {t('common.download')}
                </a>
                {deletion(record)}
              </div>
            </div>
          ))
        : query.data?.items.map((record) => (
            <div key={record.id} role="group" aria-label={record.id} style={{ marginTop: 18 }}>
              <p className="small" style={{ overflowWrap: 'anywhere' }}>
                {record.id} · {new Date(record.created_at).toLocaleString()}
              </p>
              <p className="small">{t(`workspaceBackups.states.${record.state}`)}</p>
              <p className="small muted">
                {t('workspaceBackups.planSizes', {
                  total: sizeLabel(record.retained_bytes),
                  staged: sizeLabel(record.staged_bytes),
                  previous: sizeLabel(record.previous_bytes),
                })}
              </p>
              {!record.can_delete ? (
                <p className="small muted">
                  {t(
                    record.state === 'pending'
                      ? 'workspaceBackups.cancelBeforeDelete'
                      : 'workspaceBackups.startupProtected',
                  )}
                </p>
              ) : null}
              <div className="row wrap">
                <button
                  className="btn ghost sm"
                  disabled={busy}
                  onClick={() => void review(record.id)}
                >
                  {t('workspaceBackups.review')}
                </button>
                {deletion(record)}
              </div>
            </div>
          ))}
      {query.data ? (
        <div className="row wrap" style={{ marginTop: 18 }}>
          <button
            className="btn ghost sm"
            disabled={busy || query.isFetching || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - pageSize))}
          >
            {t('common.prev')}
          </button>
          <span className="small muted">
            {t('workspaceBackups.page', {
              page: Math.floor(offset / pageSize) + 1,
              total: query.data.total,
            })}
          </span>
          <button
            className="btn ghost sm"
            disabled={busy || query.isFetching || query.data.next_offset === null}
            onClick={() => setOffset(query.data!.next_offset!)}
          >
            {t('common.next')}
          </button>
        </div>
      ) : null}
    </details>
  );
}
