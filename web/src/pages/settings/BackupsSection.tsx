import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyWorkspaceRestore,
  cancelWorkspaceRestore,
  createWorkspaceBackup,
  downloadWorkspaceBackup,
  getWorkspaceRestorePlan,
  inspectWorkspaceBackup,
  MAX_WORKSPACE_BACKUP_BYTES,
  rememberedRestorePlan,
  rememberRestorePlan,
  stageWorkspaceRestore,
  workspaceBackupDownloadUrl,
  workspaceBackupHead,
  type BackupCreated,
  type BackupInspection,
  type RestorePlan,
} from '../../api/backups';
import { ApiError } from '../../api/client';
import { flushEditors } from '../../app/useAutoDraft';
import { FilePick, Modal } from '../../components/ui';
import { BackupHistory, backupHistoryKey } from './BackupHistory';

const lookupKey = (id: string | null) => ['workspace-restore-plan', id] as const;
const exclusionNames: Record<string, string> = {
  'extension packages': 'extensions',
  'update packages': 'updates',
  caches: 'caches',
  'temporary files': 'temporary',
  'API tokens': 'tokens',
  'configured credentials': 'configured',
  'webhook secrets': 'webhooks',
  'URL credentials': 'urls',
};

function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.ceil(bytes / 1024)} KiB`;
}

function Inspection({ report }: { report: BackupInspection }) {
  const { t } = useTranslation();
  return (
    <div className="col" style={{ gap: 10 }}>
      <p>
        {t('workspaceBackups.summary', {
          series: report.series_count,
          episodes: report.episode_count,
          assets: report.asset_count,
          checkpoints: report.checkpoint_count,
          jobs: report.job_count,
        })}
      </p>
      <p className="small muted">{t('workspaceBackups.size', { size: sizeLabel(report.size) })}</p>
      <p className={report.manifest.includes_credentials ? 'notice warn' : 'small muted'}>
        {t(
          report.manifest.includes_credentials
            ? 'workspaceBackups.withCredentials'
            : 'workspaceBackups.withoutCredentials',
        )}
      </p>
      {report.manifest.exclusions.length ? (
        <details>
          <summary>{t('workspaceBackups.excluded')}</summary>
          <ul>
            {report.manifest.exclusions.map((item) => (
              <li key={item}>
                {exclusionNames[item]
                  ? t(`workspaceBackups.exclusions.${exclusionNames[item]}`)
                  : item}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PlanDetails({ plan }: { plan: RestorePlan }) {
  const { t } = useTranslation();
  const pairs = [
    ['planId', plan.id],
    ['hash', plan.inspection.sha256],
    ['head', plan.expected_head],
    ...(plan.protection_backup_id ? [['protectionId', plan.protection_backup_id]] : []),
  ];
  return (
    <details style={{ marginTop: 16 }}>
      <summary>{t('workspaceBackups.details')}</summary>
      <dl>
        {pairs.map(([key, value]) => (
          <div key={key} style={{ marginTop: 10 }}>
            <dt className="small muted">{t(`workspaceBackups.${key}`)}</dt>
            <dd style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
      {plan.protection_backup_id ? (
        <a href={workspaceBackupDownloadUrl(plan.protection_backup_id)} download className="small">
          {t('workspaceBackups.protectedDownload')}
        </a>
      ) : null}
    </details>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<BackupCreated | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const exportBackup = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await flushEditors();
      const saved = await createWorkspaceBackup(includeCredentials);
      setCreated(saved);
      void qc.invalidateQueries({ queryKey: backupHistoryKey });
      downloadWorkspaceBackup(saved.id);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t('workspaceBackups.exportTitle')}
      description={t('workspaceBackups.exportHint')}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            {t('common.close')}
          </button>
          {created ? (
            <a className="btn primary" href={workspaceBackupDownloadUrl(created.id)} download>
              {t('workspaceBackups.download')}
            </a>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void exportBackup()}>
              {busy ? <span className="spinner" /> : <Download size={15} />}
              {t('workspaceBackups.create')}
            </button>
          )}
        </>
      }
    >
      {created ? (
        <>
          <p role="status">{t('workspaceBackups.ready')}</p>
          <Inspection report={created.inspection} />
        </>
      ) : (
        <details>
          <summary>{t('workspaceBackups.advanced')}</summary>
          <label className="row" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={includeCredentials}
              disabled={busy}
              onChange={(e) => setIncludeCredentials(e.target.checked)}
            />
            {t('workspaceBackups.includeCredentials')}
          </label>
          {includeCredentials ? (
            <p className="small warn-text">{t('workspaceBackups.credentialsHint')}</p>
          ) : null}
        </details>
      )}
      {busy ? <p role="status">{t('workspaceBackups.creating')}</p> : null}
      {error ? <p role="alert">{error.message}</p> : null}
    </Modal>
  );
}

function RestoreDialog({
  initial,
  onPlan,
  onClose,
}: {
  initial: RestorePlan | null;
  onPlan: (plan: RestorePlan) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BackupInspection | null>(initial?.inspection ?? null);
  const [plan, setPlan] = useState<RestorePlan | null>(initial);
  const [action, setAction] = useState<'inspect' | 'stage' | 'apply' | 'cancel' | 'refresh' | null>(
    null,
  );
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const busy = action !== null;
  const pending = plan?.state === 'pending';
  const staged = plan?.state === 'staged';
  const savePlan = (next: RestorePlan) => {
    setPlan(next);
    setReport(next.inspection);
    onPlan(next);
  };
  const run = async (next: NonNullable<typeof action>) => {
    if (busy) return;
    setAction(next);
    setError(null);
    try {
      if (next === 'inspect' && file) {
        setReport(await inspectWorkspaceBackup(file));
        setPlan(null);
        setStale(false);
      } else if (next === 'stage' && file && report) {
        await flushEditors();
        const saved = await stageWorkspaceRestore(file);
        if (saved.inspection.sha256 !== report.sha256) {
          await cancelWorkspaceRestore(saved.id);
          setReport(null);
          throw new Error(t('workspaceBackups.changedArchive'));
        }
        savePlan(saved);
        setStale(false);
      } else if (next === 'apply' && plan) {
        await flushEditors();
        const verified = await getWorkspaceRestorePlan(plan.id);
        if (verified.state === 'pending') {
          savePlan(verified);
          return;
        }
        if (verified.state !== 'staged') {
          savePlan(verified);
          return;
        }
        if (
          verified.expected_head !== plan.expected_head ||
          verified.inspection.sha256 !== plan.inspection.sha256
        ) {
          setStale(true);
          throw new Error(t('workspaceBackups.stale'));
        }
        const current = await workspaceBackupHead();
        if (current.active_job_ids.length)
          throw new Error(t('workspaceBackups.busyJobs', { count: current.active_job_ids.length }));
        if (current.head !== verified.expected_head) {
          setStale(true);
          throw new Error(t('workspaceBackups.stale'));
        }
        savePlan((await applyWorkspaceRestore(verified)).plan);
      } else if (next === 'cancel' && plan) {
        savePlan(await cancelWorkspaceRestore(plan.id));
        setStale(false);
      } else if (next === 'refresh' && plan) {
        const saved = await getWorkspaceRestorePlan(plan.id);
        savePlan(saved);
        if (saved.state === 'staged' || saved.state === 'pending') {
          const current = await workspaceBackupHead();
          setStale(current.head !== null && current.head !== saved.expected_head);
        }
      }
    } catch (cause) {
      setError(cause as Error);
      if (next === 'apply' && cause instanceof ApiError && cause.status === 409) setStale(true);
    } finally {
      setAction(null);
    }
  };
  const phaseText =
    action === 'inspect'
      ? 'inspecting'
      : action === 'stage'
        ? 'staging'
        : action === 'apply'
          ? 'scheduling'
          : action === 'cancel'
            ? 'canceling'
            : 'loading';
  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t('workspaceBackups.restoreTitle')}
      description={t('workspaceBackups.restoreHint')}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            {t('common.close')}
          </button>
          {pending || staged ? (
            <button className="btn" disabled={busy} onClick={() => void run('cancel')}>
              {t(pending ? 'workspaceBackups.cancel' : 'workspaceBackups.cancelStaged')}
            </button>
          ) : null}
          {staged && !stale ? (
            <button className="btn primary" disabled={busy} onClick={() => void run('apply')}>
              {t('workspaceBackups.apply')}
            </button>
          ) : !pending && file && report && (!plan || stale) ? (
            <button className="btn primary" disabled={busy} onClick={() => void run('stage')}>
              {t(stale ? 'workspaceBackups.restage' : 'workspaceBackups.stage')}
            </button>
          ) : !pending && file && !report ? (
            <button className="btn primary" disabled={busy} onClick={() => void run('inspect')}>
              {t('workspaceBackups.inspect')}
            </button>
          ) : null}
        </>
      }
    >
      {!pending ? (
        <div className="row wrap" style={{ marginBottom: 16 }}>
          <FilePick
            accept=".zip"
            disabled={busy}
            onFile={(selected) => {
              setError(null);
              setReport(null);
              setPlan(null);
              setStale(false);
              if (selected.size > MAX_WORKSPACE_BACKUP_BYTES) {
                setFile(null);
                setError(new Error(t('workspaceBackups.sizeLimit')));
              } else setFile(selected);
            }}
          >
            <Upload size={15} />
            {t('workspaceBackups.choose')}
          </FilePick>
          {file ? (
            <span className="small muted">
              {file.name} · {sizeLabel(file.size)}
            </span>
          ) : null}
        </div>
      ) : null}
      {busy ? <p role="status">{t(`workspaceBackups.${phaseText}`)}</p> : null}
      {error ? <p role="alert">{error.message}</p> : null}
      {stale ? (
        <p className="notice warn">
          {t(file ? 'workspaceBackups.stale' : 'workspaceBackups.reselect')}
        </p>
      ) : null}
      {report ? <Inspection report={report} /> : null}
      {report && !plan ? <p className="small muted">{t('workspaceBackups.inspected')}</p> : null}
      {staged ? <p className="notice">{t('workspaceBackups.staged')}</p> : null}
      {staged || (report && !plan) ? (
        <p className="small muted">{t('workspaceBackups.protection')}</p>
      ) : null}
      {report ? <p className="small muted">{t('workspaceBackups.offline')}</p> : null}
      {plan ? (
        <>
          {pending ? (
            <div className="notice" role="status">
              <strong>{t('workspaceBackups.pending')}</strong>
              <p>{t('workspaceBackups.restart')}</p>
            </div>
          ) : !staged ? (
            <p role="status">
              {t(
                plan.state === 'installed'
                  ? 'workspaceBackups.installed'
                  : plan.state === 'rolled_back'
                    ? 'workspaceBackups.rolledBack'
                    : 'workspaceBackups.rejected',
              )}
            </p>
          ) : null}
          {plan.message ? <p className="small muted">{plan.message}</p> : null}
          <button className="btn ghost sm" disabled={busy} onClick={() => void run('refresh')}>
            <RefreshCw size={14} />
            {t('workspaceBackups.refresh')}
          </button>
          <PlanDetails plan={plan} />
        </>
      ) : report ? (
        <details style={{ marginTop: 16 }}>
          <summary>{t('workspaceBackups.details')}</summary>
          <p className="small muted">{t('workspaceBackups.hash')}</p>
          <code style={{ overflowWrap: 'anywhere' }}>{report.sha256}</code>
        </details>
      ) : null}
    </Modal>
  );
}

export function BackupsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [planId, setPlanId] = useState(rememberedRestorePlan);
  const [dialog, setDialog] = useState<'export' | 'restore' | null>(null);
  const lookup = useQuery({
    queryKey: lookupKey(planId),
    queryFn: () => getWorkspaceRestorePlan(planId!),
    enabled: !!planId,
    retry: false,
  });
  const missing = lookup.error instanceof ApiError && lookup.error.status === 404;
  const plan = !lookup.error ? (lookup.data ?? null) : null;
  const savePlan = (saved: RestorePlan) => {
    rememberRestorePlan(saved.id);
    qc.setQueryData(lookupKey(saved.id), saved);
    setPlanId(saved.id);
    void qc.invalidateQueries({ queryKey: backupHistoryKey });
  };
  const dismiss = () => {
    rememberRestorePlan(null);
    setPlanId(null);
  };
  return (
    <section className="settings-section">
      <h2>{t('workspaceBackups.title')}</h2>
      <div className="row wrap">
        <button className="btn" onClick={() => setDialog('export')}>
          <Download size={15} />
          {t('workspaceBackups.export')}
        </button>
        <button
          className="btn"
          disabled={!!planId && lookup.isPending}
          onClick={() => {
            if (missing) dismiss();
            setDialog('restore');
          }}
        >
          <Upload size={15} />
          {t('workspaceBackups.restore')}
        </button>
      </div>
      {planId && lookup.isPending ? (
        <p role="status" className="small muted">
          {t('workspaceBackups.loading')}
        </p>
      ) : null}
      {lookup.error ? (
        <div role="alert" style={{ marginTop: 16 }}>
          <p>{missing ? t('workspaceBackups.missingPlan') : lookup.error.message}</p>
          <button className="btn sm" onClick={() => (missing ? dismiss() : void lookup.refetch())}>
            {t(missing ? 'workspaceBackups.dismiss' : 'workspaceBackups.retry')}
          </button>
        </div>
      ) : null}
      {plan ? (
        <div className="notice" style={{ marginTop: 16 }}>
          <p>
            {t(
              plan.state === 'pending'
                ? 'workspaceBackups.pending'
                : plan.state === 'staged'
                  ? 'workspaceBackups.staged'
                  : plan.state === 'installed'
                    ? 'workspaceBackups.installed'
                    : plan.state === 'rolled_back'
                      ? 'workspaceBackups.rolledBack'
                      : 'workspaceBackups.rejected',
            )}
          </p>
          <button className="btn sm" onClick={() => setDialog('restore')}>
            {t('workspaceBackups.review')}
          </button>
          {!['pending', 'staged'].includes(plan.state) ? (
            <button className="btn ghost sm" onClick={dismiss}>
              {t('workspaceBackups.dismiss')}
            </button>
          ) : null}
        </div>
      ) : null}
      <BackupHistory
        onReview={(saved) => {
          savePlan(saved);
          setDialog('restore');
        }}
        onDeletedPlan={(id) => {
          qc.removeQueries({ queryKey: lookupKey(id) });
          if (id === planId) dismiss();
        }}
      />
      {dialog === 'export' ? <ExportDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'restore' ? (
        <RestoreDialog initial={plan} onPlan={savePlan} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}
