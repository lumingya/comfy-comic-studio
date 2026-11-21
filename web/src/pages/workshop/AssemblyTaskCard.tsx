import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, data } from '../../api/client';
import { useJobControl, useRetryJob } from '../../api/jobs';
import { keys } from '../../api/keys';
import { useRender } from '../../api/production';
import { usePatchSeries } from '../../api/series';
import type { Job } from '../../api/types';
import { Icon } from '../../app/icons';
import { toastError } from '../../components/toast';
import { InlineTitle } from '../../components/ui';
import {
  ACTIVE_JOB,
  errorCategory,
  failureSummary,
  pageProgress,
  type PageProgress,
} from './taskProgress';
import type { OverridePart } from './queueView';
import { access, type Task } from './assemblyTasks';
import { AssemblyTaskActions, type AssemblyTaskActionsProps } from './AssemblyTaskActions';
import { AssemblyTaskPages } from './AssemblyTaskPages';

const ACTIVE = ACTIVE_JOB;

function OverridesSummary({ parts }: { parts: OverridePart[] }) {
  const { t } = useTranslation();
  if (!parts.length) return null;
  return (
    <p className="production-overrides">
      {parts.map((p, i) => (
        <span key={i} title={p.title || undefined}>
          <i>
            {t(`ws.queue.ov.${p.kind}`)}
            {p.key ? ` #${p.key}` : ''}
          </i>
          {p.kind === 'noLora' ? t('ws.queue.ov.none') : p.name}
          {p.kind === 'lora' ? <b>×{p.strength}</b> : null}
        </span>
      ))}
    </p>
  );
}

export function AssemblyTaskCard({
  task,
  selected,
  context,
  profileName,
  overrides,
  globalConcurrency,
  notice,
  starting,
  dragging,
  drop,
  removing,
  onGripDown,
  onStart,
  onPause,
  onResume,
  onStop,
  onDequeue,
  onRemove,
}: {
  task: Task;
  selected?: boolean;
  context?: boolean;
  profileName?: string;
  overrides: OverridePart[];
  notice?: string;
  dragging: boolean;
  drop: 'before' | 'after' | null;
  onGripDown: (e: ReactPointerEvent<HTMLElement>) => void;
} & AssemblyTaskActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album, episode, adopted, state } = task;
  const a = access(task);
  const render = useRender(episode?.id ?? '');
  const patch = usePatchSeries(album.id!);
  const control = useJobControl();
  const retry = useRetryJob();
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const panels = useMemo(
    () => [...(episode?.panels ?? [])].sort((a, b) => a.order - b.order),
    [episode?.panels],
  );
  // Items of the jobs that can still say something the takes cannot: running, queued or failed.
  const watched = task.recent
    .slice(0, 3)
    .filter((j) => ACTIVE.includes(j.state) || (j.failed ?? 0) > 0 || j.state === 'failed');
  const details = useQueries({
    queries: watched.map((j) => ({
      queryKey: keys.job(j.id),
      queryFn: async () =>
        data(
          await api.GET('/api/jobs/{job_id}', { params: { path: { job_id: j.id } } }),
        ) as unknown as Job,
    })),
  });
  const detailed = details.map((q) => q.data).filter((j): j is Job => !!j);
  const pages = pageProgress(episode, detailed);
  const failure = state === 'done' ? null : failureSummary(pages, detailed);
  const pageOf = (id: string): PageProgress => pages.get(id) ?? { state: 'standby' };
  /** Reruns add candidates; only frames without an adopted image adopt the first result. */
  const rerun = (ids: string[]) => {
    if (render.isPending || !ids.length) return;
    render.mutate({ panel_ids: ids, adopt_first: true }, { onError: toastError });
  };
  const retryFailed = () => {
    if (!failure) return;
    if (failure.held && failure.indexes.length)
      retry.mutate({ id: failure.jobId, indexes: failure.indexes }, { onError: toastError });
    else if (failure.held)
      control.mutate({ id: failure.jobId, action: 'resume' }, { onError: toastError });
    else onStart();
  };
  const category = failure ? errorCategory(failure.kind) : 'other';
  const settingsTab =
    category === 'workflow'
      ? 'workflows'
      : category === 'channel' || category === 'rate'
        ? 'channels'
        : 'instances';
  const classes = [
    'production-card',
    state === 'running' ? 'is-running' : '',
    state === 'paused' ? 'is-held' : '',
    a.queued ? 'is-queued' : '',
    selected ? 'is-selected' : '',
    context ? 'is-context' : '',
    dragging ? 'is-dragging' : '',
    drop ? 'is-drop-target' : '',
    drop === 'after' ? 'is-drop-after' : '',
  ];
  return (
    <article
      className={classes.filter(Boolean).join(' ')}
      data-production-task={album.id}
      data-selection-id={album.id}
      tabIndex={0}
      aria-selected={selected || undefined}
    >
      <header>
        <div
          className="production-card-title"
          onPointerDown={(event) => {
            if (
              event.pointerType !== 'mouse' ||
              !(event.target instanceof Element) ||
              event.target.closest('input,textarea,select,button,a,[contenteditable]')
            )
              return;
            onGripDown(event);
          }}
        >
          <button
            type="button"
            className="production-grip"
            tabIndex={-1}
            aria-hidden="true"
            title={t('ws.queue.grip')}
            onPointerDown={onGripDown}
          >
            ⠿
          </button>
          <span className={`production-state state-${state}`}>{t(`ws.queue.state.${state}`)}</span>
          {a.queued ? (
            <span className="production-flag flag-queued">
              {t('ws.queue.queuedAt', { n: task.position })}
            </span>
          ) : null}
          {renaming ? (
            <InlineTitle
              autoFocus
              onCancel={() => {
                setRenaming(false);
                renameButton.current?.focus({ preventScroll: true });
              }}
              onFinish={() => setRenaming(false)}
              value={album.title}
              label={t('ws.queue.rename')}
              onSave={async (title) => {
                await patch.mutateAsync({ title }, { onError: toastError });
                setRenaming(false);
              }}
            />
          ) : (
            <h2>{album.title}</h2>
          )}
          <button
            ref={renameButton}
            type="button"
            className="ibtn production-rename"
            title={t('ws.queue.rename')}
            aria-label={t('ws.queue.renameOf', { title: album.title })}
            onClick={() => setRenaming(true)}
          >
            <Icon name="edit" sm />
          </button>
        </div>
        <div className="production-count">
          <b>{adopted.size}</b>
          <span>{t('ws.queue.ofFrames', { count: panels.length })}</span>
        </div>
      </header>
      <p className="production-meta">
        <span>{t('ws.queue.metaStory', { title: episode?.title ?? '…' })}</span>
        {album.presets.length ? (
          <span>
            {t('ws.queue.metaPresets', { titles: album.presets.map((p) => p.title).join('、') })}
          </span>
        ) : null}
        <span>{t('ws.queue.metaProfile', { name: profileName ?? 'ComfyUI' })}</span>
      </p>
      <OverridesSummary parts={overrides} />
      <div className={`production-strip ${panels.length > 48 ? 'dense' : ''}`} aria-hidden="true">
        {panels.map((p) => (
          <i key={p.id} className={`seg-${pageOf(p.id!).state}`} />
        ))}
      </div>
      {notice ? (
        <p className="production-notice" role="status">
          {t('ws.queue.notStarted', { message: notice })}
        </p>
      ) : null}
      {task.stopped && !failure ? (
        <p className="production-notice" role="status">
          {t('ws.queue.stopped')}
        </p>
      ) : null}
      {failure ? (
        <div className="production-error-panel" role="alert" data-error-kind={category}>
          <p className="production-error-head">
            <strong>{t(`ws.queue.fail.${category}`)}</strong>
            {failure.count ? (
              <span>{t('ws.queue.fail.count', { count: failure.count })}</span>
            ) : null}
            {failure.held ? <span>{t('ws.queue.fail.held')}</span> : null}
          </p>
          {failure.message ? <p className="production-error">{failure.message}</p> : null}
          {failure.note ? <p className="production-error-tail">{failure.note}</p> : null}
          <div className="production-error-actions">
            <button
              type="button"
              className="btn small"
              title={t('ws.queue.fail.retryHint')}
              disabled={
                starting || render.isPending || retry.isPending || control.isPending || !episode
              }
              onClick={retryFailed}
            >
              <Icon name="refresh" sm />
              {t('ws.queue.fail.retry')}
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => navigate(`/engine?tab=${settingsTab}`)}
            >
              <Icon name="settings" sm />
              {t(`ws.queue.fail.${settingsTab}`)}
            </button>
            {failure.jobId ? (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => navigate(`/jobs?job=${failure.jobId}`)}
              >
                <Icon name="help" sm />
                {t('ws.queue.fail.details')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <AssemblyTaskActions
        task={task}
        starting={starting}
        globalConcurrency={globalConcurrency}
        removing={removing}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
        onDequeue={onDequeue}
        onRemove={onRemove}
      />
      <AssemblyTaskPages
        task={task}
        panels={panels}
        pages={pages}
        openOnFailure={!!failure}
        rerunning={render.isPending}
        onRerun={rerun}
      />
    </article>
  );
}
