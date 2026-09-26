import { Ban, Pause, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useJob, useJobControl, useLive, useResolveItem, useRetryJob } from '../../api/jobs';
import type { JobItem } from '../../api/types';
import { toastError } from '../../components/toast';
import { Loading, Modal, Progress } from '../../components/ui';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

function ItemRow({
  jobId,
  item,
  onResolve,
}: {
  jobId: string;
  item: JobItem;
  onResolve: (i: JobItem) => void;
}) {
  const { t } = useTranslation();
  const progress = useLive((s) => s.progress[`${jobId}:${item.idx}`]);
  const images = item.result?.images ?? [];
  return (
    <tr className={`item-${item.state}`}>
      <td className="mono muted">{item.idx}</td>
      <td>{item.label}</td>
      <td>
        <span className={`chip state-${item.state}`}>{t(`jobs.states.${item.state}`)}</span>
        {item.state === 'running' && progress !== undefined ? <Progress value={progress} /> : null}
      </td>
      <td className="small muted">
        {item.error ? <span className="danger">{item.error.message}</span> : null}
        {item.attempts > 1 ? ` ×${item.attempts}` : ''}
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          {images.slice(0, 3).map((im) => (
            <img key={im.asset_id} className="thumb" src={assetUrl(im.asset_id, 96)} alt="" />
          ))}
          {item.state === 'uncertain' ? (
            <button className="btn sm" onClick={() => onResolve(item)}>
              {t('jobs.resolve')}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

export function JobDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const job = useJob(id);
  const control = useJobControl();
  const retry = useRetryJob();
  const resolve = useResolveItem();
  const [resolving, setResolving] = useState<JobItem | null>(null);
  if (job.isLoading || !job.data) return <Loading />;
  const j = job.data;
  const items = j.items ?? [];
  const done = items.filter((i) => ['complete', 'skipped'].includes(i.state)).length;
  const failed = items.filter((i) => ['failed', 'canceled'].includes(i.state));
  const uncertain = items.filter((i) => i.state === 'uncertain');
  const act = (action: 'pause' | 'resume' | 'cancel') =>
    control.mutate({ id, action }, { onError: toastError });
  const doResolve = (action: 'reconcile' | 'failed' | 'resubmit') =>
    resolving &&
    resolve.mutate(
      { id, idx: resolving.idx, action },
      { onSuccess: () => setResolving(null), onError: toastError },
    );

  return (
    <div className="col" style={{ gap: 16 }}>
      <header className="row">
        <div className="grow">
          <div className="overline">{j.kind}</div>
          <h2 style={{ margin: 0 }}>{j.title}</h2>
          <div className="small muted">
            <span className={`chip state-${j.state}`}>{t(`jobs.states.${j.state}`)}</span> {done}/
            {items.length}
            {j.owner ? (
              <>
                {' · '}
                <Link to={`/episodes/${j.owner}/board`}>{t('jobs.openEpisode')}</Link>
              </>
            ) : null}
          </div>
        </div>
        {ACTIVE.includes(j.state) && !j.paused ? (
          <button className="btn" onClick={() => act('pause')}>
            <Pause size={14} /> {t('jobs.pause')}
          </button>
        ) : null}
        {j.paused || j.state === 'blocked' ? (
          <button className="btn" onClick={() => act('resume')}>
            <Play size={14} /> {t('jobs.resume')}
          </button>
        ) : null}
        {ACTIVE.includes(j.state) ? (
          <button className="btn danger" onClick={() => act('cancel')}>
            <Ban size={14} /> {t('jobs.cancel')}
          </button>
        ) : null}
        {failed.length ? (
          <button
            className="btn"
            onClick={() =>
              retry.mutate({ id, indexes: failed.map((i) => i.idx) }, { onError: toastError })
            }
          >
            <RotateCcw size={14} /> {t('jobs.retryFailed', { count: failed.length })}
          </button>
        ) : null}
      </header>
      <Progress value={items.length ? done / items.length : 0} />
      {j.error ? <div className="notice error">{j.error}</div> : null}
      {uncertain.length ? (
        <div className="notice warn">{t('jobs.uncertainHint', { count: uncertain.length })}</div>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('jobs.item')}</th>
            <th>{t('jobs.state')}</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <ItemRow key={it.idx} jobId={id} item={it} onResolve={setResolving} />
          ))}
        </tbody>
      </table>
      <Modal
        open={!!resolving}
        onOpenChange={(o) => !o && setResolving(null)}
        title={t('jobs.resolveTitle', { label: resolving?.label ?? '' })}
        description={t('jobs.resolveHint')}
        footer={
          <>
            <button className="btn" onClick={() => doResolve('failed')}>
              {t('jobs.markFailed')}
            </button>
            <button className="btn" onClick={() => doResolve('reconcile')}>
              {t('jobs.reconcile')}
            </button>
            <button className="btn danger" onClick={() => doResolve('resubmit')}>
              {t('jobs.resubmit')}
            </button>
          </>
        }
      >
        <p className="small muted">{t('jobs.resubmitWarn')}</p>
      </Modal>
    </div>
  );
}
