import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useCloneTask } from '../../api/workshop';
import { usePatchSeries } from '../../api/series';
import type { SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import { toast, toastError } from '../../components/toast';
import { ConcurrencyInput } from './AssemblyToolbar';
import { access, type Task } from './assemblyTasks';

export interface AssemblyTaskActionsProps {
  task: Task;
  starting: boolean;
  globalConcurrency: number;
  removing: boolean;
  onStart: (only?: string[]) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDequeue: () => void;
  onRemove: () => void;
}

export function AssemblyTaskActions({
  task,
  starting,
  globalConcurrency,
  removing,
  onStart,
  onPause,
  onResume,
  onStop,
  onDequeue,
  onRemove,
}: AssemblyTaskActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album, episode, adopted, state } = task;
  const a = access(task);
  const patch = usePatchSeries(album.id!);
  return (
    <div className="production-card-actions">
      {a.busy ? (
        <>
          {state === 'paused' ? (
            <button
              type="button"
              className="btn"
              title={t('ws.queue.resumeHint')}
              onClick={onResume}
            >
              <Icon name="play" />
              {t('ws.queue.resume')}
            </button>
          ) : (
            <button type="button" className="btn" title={t('ws.queue.pauseHint')} onClick={onPause}>
              <Icon name="pause" />
              {t('ws.queue.pause')}
            </button>
          )}
          <button
            type="button"
            className="btn ghost"
            title={t('ws.queue.stopHint')}
            onClick={onStop}
          >
            <Icon name="stop" />
            {t('ws.queue.stop')}
          </button>
        </>
      ) : a.queued ? (
        // Own keys: the start button must not reuse this node (and its focus) once the card
        // leaves the queue, or a second click / Enter would start the album.
        <button
          key="dequeue"
          type="button"
          className="btn"
          title={t('ws.queue.dequeueHint')}
          onClick={onDequeue}
        >
          <Icon name="close" />
          {t('ws.queue.dequeue')}
        </button>
      ) : (
        <button
          key="start"
          type="button"
          className="btn"
          disabled={!a.canStart || starting}
          onClick={() => onStart()}
        >
          <Icon name="play" />
          {t('ws.queue.start')}
        </button>
      )}
      <button
        type="button"
        className="btn ghost small"
        disabled={!episode}
        title={t('ws.queue.candidatesHint')}
        onClick={() => navigate(`/workshop/assembly/${episode!.id}`)}
      >
        <Icon name="image" sm />
        {t('ws.queue.candidates')}
      </button>
      <button
        type="button"
        className="btn ghost small"
        disabled={!adopted.size}
        onClick={() => navigate(`/gallery/${album.id}`)}
      >
        <Icon name="book" sm />
        {t('ws.queue.read')}
      </button>
      <CloneButton album={album} disabled={!episode} />
      <ConcurrencyInput
        caption={t('ws.queue.concurrency')}
        label={t('ws.queue.concurrencyOf', { title: album.title })}
        hint={t('ws.queue.concurrencyHint', { n: globalConcurrency })}
        value={album.concurrency ?? null}
        placeholder={t('ws.queue.concurrencyGlobal', { n: globalConcurrency })}
        onCommit={(concurrency) => patch.mutate({ concurrency }, { onError: toastError })}
      />
      <span className="grow" />
      <button
        type="button"
        className="btn ghost small production-remove"
        disabled={!task.ready || removing}
        onClick={onRemove}
      >
        <Icon name="trash" sm />
        {t('ws.queue.remove')}
      </button>
    </div>
  );
}

function CloneButton({ album, disabled }: { album: SeriesCard; disabled: boolean }) {
  const { t } = useTranslation();
  const clone = useCloneTask();
  return (
    <button
      type="button"
      className="btn ghost small production-clone"
      disabled={disabled || clone.isPending}
      title={t('ws.queue.cloneHint')}
      onClick={() =>
        clone.mutate(album.id!, {
          onSuccess: (out) => toast(t('ws.queue.cloned', { title: out.series.title })),
          onError: toastError,
        })
      }
    >
      <Icon name="copy" sm />
      {t('ws.queue.clone')}
    </button>
  );
}
