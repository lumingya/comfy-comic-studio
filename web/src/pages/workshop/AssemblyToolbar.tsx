import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/keys';
import type { QueueStatus } from '../../api/types';
import { Icon } from '../../app/icons';
import { SetupRemaining } from '../../components/HelpDrawer';
import { toast, toastError } from '../../components/toast';
import { headlineTitle } from './queueView';
import { assemblyQueueState, type Task } from './assemblyTasks';
import type { AssemblyActions } from './assemblyActions';

const MAX_CONCURRENCY = 128;

export function AssemblyToolbar({
  tasks,
  queue,
  actions,
}: {
  tasks: Task[];
  queue: QueueStatus | undefined;
  actions: AssemblyActions;
}) {
  const { t } = useTranslation();
  const {
    auto,
    globalConcurrency,
    running,
    held,
    queued,
    lanePaused,
    sequenceable,
    done,
    canPause,
    canResume,
    canCancel,
  } = assemblyQueueState(tasks, queue);
  const { act, queueRun, pauseAll, resumeAll, cancelAll } = actions;
  const title = headlineTitle({
    running: running.length,
    queued: queued.length,
    heldBooks: held.length,
    lanePaused,
  });
  const detailParts = [
    running.length ? t('ws.queue.detail.running', { count: running.length }) : '',
    queued.length ? t('ws.queue.detail.queued', { count: queued.length }) : '',
    held.length ? t('ws.queue.detail.held', { count: held.length }) : '',
    lanePaused && queued.length && !(running.length - held.length)
      ? t('ws.queue.detail.laneHeld')
      : '',
  ].filter(Boolean);
  const detail = detailParts.length
    ? detailParts.join(' · ')
    : t('ws.queue.detail.idle', { count: tasks.length, n: globalConcurrency });

  return (
    <div className="production-controls">
      <div>
        <strong>{t(`ws.queue.head.${title}`, { count: running.length - held.length })}</strong>
        <small>{detail}</small>
        <SetupRemaining />
      </div>
      <div className="production-toolbar">
        <button
          type="button"
          className="btn"
          disabled={!sequenceable.length || act.isPending}
          title={
            sequenceable.length
              ? t('ws.queue.menu.sequenceHint', { count: sequenceable.length })
              : t('ws.queue.nothingSequence')
          }
          onClick={() => queueRun(sequenceable.map((x) => x.album.id!))}
        >
          <Icon name="list" />
          {t('ws.queue.sequence')}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!canPause}
          title={canPause ? t('ws.queue.menu.pauseAllHint') : t('ws.queue.nothingRunning')}
          onClick={pauseAll}
        >
          <Icon name="pause" />
          {t('ws.queue.pauseAll')}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!canResume}
          title={canResume ? t('ws.queue.menu.resumeAllHint') : t('ws.queue.nothingPaused')}
          onClick={resumeAll}
        >
          <Icon name="play" />
          {t('ws.queue.resumeAll')}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={!canCancel}
          title={canCancel ? undefined : t('ws.queue.nothingActive')}
          onClick={() => void cancelAll()}
        >
          <Icon name="stop" />
          {t('ws.queue.cancelAll')}
        </button>
        <ClearFinished done={done} />
        <ConcurrencyInput
          className="production-concurrency-global"
          caption={t('ws.queue.defaultConcurrency')}
          label={t('ws.queue.defaultConcurrencyLabel')}
          hint={t('ws.queue.defaultConcurrencyHint', { n: auto })}
          value={queue?.concurrency ?? null}
          placeholder={t('ws.queue.auto', { n: auto })}
          disabled={!queue}
          onCommit={(value) =>
            act.mutate({ action: 'concurrency', value }, { onError: toastError })
          }
        />
      </div>
    </div>
  );
}

/** Panel concurrency field; empty follows the default. An invalid value snaps back. */
export function ConcurrencyInput({
  value,
  placeholder,
  caption,
  label,
  hint,
  className = '',
  disabled,
  onCommit,
}: {
  value: number | null;
  placeholder: string;
  caption: string;
  label: string;
  hint: string;
  className?: string;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value?.toString() ?? '');
  useEffect(() => setText(value?.toString() ?? ''), [value]);
  const commit = () => {
    const raw = text.trim();
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > MAX_CONCURRENCY)) {
      toast(t('ws.queue.concurrencyInvalid', { max: MAX_CONCURRENCY }));
      setText(value?.toString() ?? '');
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <label className={`production-concurrency ${className}`} title={hint}>
      <span>{caption}</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_CONCURRENCY}
        step={1}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(value?.toString() ?? '');
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ClearFinished({ done }: { done: Task[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={!done.length || busy}
      title={
        done.length ? t('ws.queue.clearHint', { count: done.length }) : t('ws.queue.nothingDone')
      }
      onClick={async () => {
        setBusy(true);
        try {
          for (const x of done)
            await api.PATCH('/api/series/{series_id}', {
              params: { path: { series_id: x.album.id! } },
              body: { status: 'active' } as never,
            });
          toast(t('ws.queue.cleared', { count: done.length }));
        } catch (e) {
          toastError(e);
        } finally {
          setBusy(false);
          qc.invalidateQueries({ queryKey: ['series'] });
          qc.invalidateQueries({ queryKey: keys.queue });
        }
      }}
    >
      <Icon name="brush" />
      {t('ws.queue.clear')}
    </button>
  );
}
