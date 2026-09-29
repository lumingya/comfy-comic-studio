import { useSelection } from '../../app/selection';
import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import { ContextMenu, useContextMenu } from '../../components/ContextMenu';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl, data } from '../../api/client';
import { useJobControl, useJobs, useLive, useRetryJob } from '../../api/jobs';
import { keys } from '../../api/keys';
import { useRender } from '../../api/production';
import { useCloneTask } from '../../api/workshop';
import { usePatchSeries, useSeriesList, useTrashSeries } from '../../api/series';
import type { Episode, Job, SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { SetupRemaining } from '../../components/HelpDrawer';
import { QueryError } from '../../app/errors';
import { InlineTitle, Loading, Modal } from '../../components/ui';
import AssembleDialog from './AssembleDialog';
import { WorkshopFrame } from './WorkshopPage';
import {
  ACTIVE_JOB,
  errorCategory,
  failureSummary,
  pageProgress,
  type PageProgress,
} from './taskProgress';

const ACTIVE = ACTIVE_JOB;

/** Tasks 「开始生成」 applies to: never run, or the last run left failed frames. */
const startable = (task: Task) => task.state === 'standby' || task.state === 'failed';

export interface Task {
  album: SeriesCard;
  episode: Episode | undefined;
  /** Active jobs of this album. */
  jobs: Job[];
  /** Every recent job of this album, newest first (failed and finished ones too). */
  recent: Job[];
  adopted: Set<string>;
  state: 'standby' | 'running' | 'paused' | 'done' | 'failed';
  ready: boolean;
}

function useTasks() {
  const list = useSeriesList();
  const albums = useMemo(() => (list.data ?? []).filter((s) => s.status === 'draft'), [list.data]);
  const firstEpisodes = useQueries({
    queries: albums.map((s) => ({
      queryKey: keys.episodes(s.id!, 0),
      queryFn: async () =>
        data(
          await api.GET('/api/series/{series_id}/episodes', {
            params: { path: { series_id: s.id! }, query: { offset: 0, limit: 50 } },
          }),
        ) as unknown as { items: { id: string }[] },
    })),
  });
  const ids = firstEpisodes.map((q) => q.data?.items[0]?.id);
  const episodes = useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.episode(id ?? ''),
      enabled: !!id,
      queryFn: async () =>
        data(
          await api.GET('/api/episodes/{episode_id}', { params: { path: { episode_id: id! } } }),
        ),
    })),
  });
  // Not only the active ones: a task whose last run failed must say so (legacy 异常).
  const jobs = useJobs(undefined, false, 300);
  const tasks: Task[] = albums.map((album, i) => {
    const episode = episodes[i]?.data;
    const recent = (jobs.data ?? []).filter((j) => !!episode && j.owner === episode.id);
    const mine = recent.filter((j) => ACTIVE.includes(j.state));
    const adopted = new Set(
      (episode?.takes ?? [])
        .filter((t) => t.status === 'adopted' && !t.variant_id)
        .map((t) => t.panel_id),
    );
    const total = episode?.panels.length ?? album.panel_count ?? 0;
    const state: Task['state'] = mine.some((j) => j.state !== 'paused' && !j.paused)
      ? 'running'
      : mine.length
        ? 'paused'
        : total > 0 && adopted.size >= total
          ? 'done'
          : recent[0] && ((recent[0].failed ?? 0) > 0 || recent[0].state === 'failed')
            ? 'failed'
            : 'standby';
    const ready =
      !jobs.isPending &&
      !jobs.isError &&
      !firstEpisodes[i]?.isPending &&
      !firstEpisodes[i]?.isError &&
      (!ids[i] || (!episodes[i]?.isPending && !episodes[i]?.isError));
    return { album, episode, jobs: mine, recent, adopted, state, ready };
  });
  return {
    tasks,
    isLoading: list.isLoading,
    jobs: jobs.data ?? [],
    error:
      list.error ||
      jobs.error ||
      firstEpisodes.find((q) => q.error)?.error ||
      episodes.find((q) => q.error)?.error,
    retry: () => {
      void list.refetch();
      void jobs.refetch();
      firstEpisodes.forEach((q) => void q.refetch());
      episodes.forEach((q) => void q.refetch());
    },
  };
}

/** 装配与队列: assembled albums waiting for 「开始生成」, with progress and partial reruns. */
export default function AssemblyTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => params.has('story') || params.has('new'));
  const { tasks, isLoading, jobs, error, retry } = useTasks();
  const control = useJobControl();
  const active = jobs.filter(
    (j) => ACTIVE.includes(j.state) && tasks.some((x) => x.episode?.id === j.owner),
  );
  const running = active.filter((j) => !j.paused && j.state !== 'paused');
  const paused = active.filter((j) => j.paused || j.state === 'paused');
  const done = tasks.filter((x) => x.state === 'done');
  const [sequence, setSequence] = useState(false);
  const [sequenceRun, setSequenceRun] = useState(0);
  const taskIds = useMemo(() => tasks.map((task) => task.album.id!), [tasks]);
  const selection = useSelection(taskIds);
  const menu = useContextMenu<DesktopContext>();
  const clone = useCloneTask();
  const trash = useTrashSeries();
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedTasks = (ids: string[]) => tasks.filter((task) => ids.includes(task.album.id!));
  const removeTasks = async (ids: string[]) => {
    const targets = selectedTasks(ids);
    if (
      bulkBusy ||
      targets.some((task) => !task.ready) ||
      !(await confirm({
        title: t('classic.shelf.bulkDeleteTitle', { count: targets.length }),
        description: t('ws.queue.removeHelp'),
        danger: true,
      }))
    )
      return;
    setSequence(false);
    setBulkBusy(true);
    try {
      for (const task of targets) {
        for (const job of task.jobs) await control.mutateAsync({ id: job.id, action: 'cancel' });
        await trash.mutateAsync(task.album.id!);
      }
      selection.clear();
    } catch (error) {
      toastError(error);
    } finally {
      setBulkBusy(false);
    }
  };
  const cloneTasks = async (ids: string[]) => {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const id of ids) await clone.mutateAsync(id);
    } catch (error) {
      toastError(error);
    } finally {
      setBulkBusy(false);
    }
  };
  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: true,
    pinned: false,
    contextOpen: !!menu.state,
    onExit: selection.clear,
    onOpen: () => {},
    onDelete: (ids) => {
      void removeTasks(ids);
    },
    onContext: menu.openAt,
    onCloseContext: menu.close,
  });

  const each = (list: Job[], action: 'pause' | 'resume' | 'cancel') =>
    Promise.all(list.map((j) => control.mutateAsync({ id: j.id, action }))).catch(toastError);

  return (
    <WorkshopFrame
      tab="assembly"
      actions={
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          <Icon name="plus" />
          {t('ws.queue.new')}
        </button>
      }
    >
      <div className="production-controls">
        <div>
          <strong>{t('ws.queue.title')}</strong>
          <small>{t('ws.queue.summary', { count: tasks.length })}</small>
          <SetupRemaining />
        </div>
        <div className="production-toolbar">
          <button
            type="button"
            className="btn"
            disabled={
              !sequence && !tasks.some((x) => startable(x) && x.ready && !!x.episode?.panels.length)
            }
            title={sequence ? t('interaction.stopSequenceHint') : undefined}
            onClick={() => {
              if (sequence) setSequence(false);
              else {
                setSequenceRun((n) => n + 1);
                setSequence(true);
              }
            }}
          >
            <Icon name="list" />
            {sequence ? t('interaction.stopSequence') : t('ws.queue.sequence')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!running.length}
            title={running.length ? undefined : t('ws.queue.nothingRunning')}
            onClick={() => {
              setSequence(false);
              void each(running, 'pause');
            }}
          >
            <Icon name="pause" />
            {t('ws.queue.pauseAll')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!paused.length}
            title={paused.length ? undefined : t('ws.queue.nothingPaused')}
            onClick={() => each(paused, 'resume')}
          >
            <Icon name="play" />
            {t('ws.queue.resumeAll')}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={!active.length}
            title={active.length ? undefined : t('ws.queue.nothingActive')}
            onClick={async () => {
              if (await confirm({ title: t('ws.queue.cancelConfirm'), danger: true })) {
                setSequence(false);
                void each(active, 'cancel');
              }
            }}
          >
            <Icon name="stop" />
            {t('ws.queue.cancelAll')}
          </button>
          <ClearFinished done={done} />
        </div>
      </div>
      {error ? <QueryError error={error} onRetry={retry} /> : null}
      {isLoading ? (
        <Loading />
      ) : tasks.length ? (
        <div
          className="production-cards desktop-list"
          ref={desktop.ref}
          tabIndex={0}
          role="region"
          aria-label={t('interaction.list')}
          onClickCapture={desktop.onClickCapture}
          onContextMenu={desktop.onContextMenu}
          onPointerDown={desktop.onPointerDown}
          onDragStartCapture={desktop.onDragStartCapture}
        >
          {(desktop.snapshot ?? selection.ids).length ? (
            <div className="selection-bar" role="status">
              <span>
                {t('interaction.selected', { count: (desktop.snapshot ?? selection.ids).length })}
              </span>
              <button
                type="button"
                className="btn small"
                disabled={bulkBusy}
                onClick={() => void cloneTasks(selection.ids)}
              >
                {t('ws.queue.clone')}
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={bulkBusy || selectedTasks(selection.ids).some((task) => !task.ready)}
                onClick={() => void removeTasks(selection.ids)}
              >
                {t('common.delete')}
              </button>
              <button type="button" className="btn ghost small" onClick={selection.clear}>
                {t('common.cancel')}
              </button>
            </div>
          ) : null}
          {tasks.map((task, i) => (
            <TaskCard
              key={task.album.id}
              task={task}
              selected={selection.has(task.album.id!)}
              context={menu.state?.payload.focusId === task.album.id}
              // Legacy lane: one book after another; a failed book does not hold up the rest.
              autostart={
                sequence &&
                tasks.slice(0, i).every((x) => x.state === 'done' || x.state === 'failed')
              }
              sequenceRun={sequenceRun}
              onStartFailed={() => setSequence(false)}
              onStarted={() => {
                if (!tasks.slice(i + 1).some(startable)) setSequence(false);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="eco-empty production-empty">
          <p>{t('ws.queue.empty')}</p>
        </div>
      )}
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          returnFocus={menu.state.payload.target}
          onClose={menu.close}
          groups={[
            {
              items: [
                {
                  label: t('ws.queue.clone'),
                  disabled: bulkBusy,
                  onSelect: () => {
                    void cloneTasks(menu.state!.payload.ids);
                  },
                },
                {
                  label: t('common.delete'),
                  danger: true,
                  disabled:
                    bulkBusy || selectedTasks(menu.state.payload.ids).some((task) => !task.ready),
                  onSelect: () => {
                    void removeTasks(menu.state!.payload.ids);
                  },
                },
                { label: t('classic.shelf.selectFiltered'), onSelect: selection.all },
                { label: t('classic.shelf.clearSelection'), onSelect: selection.clear },
              ],
            },
          ]}
        />
      ) : null}
      {open ? (
        <AssembleDialog
          initialStory={params.get('story') ?? undefined}
          onClose={() => {
            setOpen(false);
            if (params.has('story') || params.has('new')) {
              params.delete('story');
              params.delete('new');
              setParams(params, { replace: true });
            }
          }}
        />
      ) : null}
    </WorkshopFrame>
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
      title={done.length ? t('ws.queue.clearHint') : t('ws.queue.nothingDone')}
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
        }
      }}
    >
      <Icon name="brush" />
      {t('ws.queue.clear')}
    </button>
  );
}

function TaskCard({
  task,
  autostart,
  onStarted,
  sequenceRun,
  onStartFailed,
  selected,
  context,
}: {
  task: Task;
  autostart: boolean;
  onStarted: () => void;
  sequenceRun: number;
  onStartFailed: () => void;
  selected?: boolean;
  context?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album, episode, adopted, state } = task;
  const render = useRender(episode?.id ?? '');
  const trash = useTrashSeries();
  const clone = useCloneTask();
  const patch = usePatchSeries(album.id!);
  const control = useJobControl();
  const retry = useRetryJob();
  const offline = useLive((s) => s.connected === false);
  const [renaming, setRenaming] = useState(false);
  const [preview, setPreview] = useState<{ asset: string; n: number } | null>(null);
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
      refetchInterval: offline && ACTIVE.includes(j.state) ? 3000 : (false as const),
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
  const lastRun = useRef<number | null>(null);
  const start = (ids?: string[]) => {
    if (render.isPending || !episode) return;
    const missing = ids ?? panels.filter((p) => !adopted.has(p.id!)).map((p) => p.id!);
    if (!missing.length) return;
    render.mutate(
      { panel_ids: missing, candidates: 1, adopt_first: true },
      {
        onSuccess: onStarted,
        onError: (error) => {
          onStartFailed();
          toastError(error);
        },
      },
    );
  };
  /** Legacy 单幕重跑 / 从此幕往后重跑: new images replace the ones already in the album. */
  const rerun = (ids: string[]) => {
    if (render.isPending || !ids.length) return;
    const replace = ids.some((id) => adopted.has(id));
    render.mutate(
      { panel_ids: ids, candidates: 1, adopt_first: true, adopt_replace: replace },
      { onError: toastError },
    );
  };
  const retryFailed = () => {
    if (!failure) return;
    if (failure.held && failure.indexes.length)
      retry.mutate({ id: failure.jobId, indexes: failure.indexes }, { onError: toastError });
    else if (failure.held)
      control.mutate({ id: failure.jobId, action: 'resume' }, { onError: toastError });
    else start();
  };
  const ready = autostart && startable(task) && !task.jobs.length && !!episode && !render.isPending;
  useEffect(() => {
    if (ready && lastRun.current !== sequenceRun) {
      lastRun.current = sequenceRun;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sequenceRun]);
  const category = failure ? errorCategory(failure.kind) : 'other';
  const settingsTab =
    category === 'workflow' ? 'workflows' : category === 'channel' ? 'channels' : 'instances';
  return (
    <article
      className={`production-card ${state === 'running' ? 'is-running' : ''} ${state === 'paused' ? 'is-held' : ''} ${selected ? 'is-selected' : ''} ${context ? 'is-context' : ''}`}
      data-production-task={album.id}
      data-selection-id={album.id}
      tabIndex={0}
      aria-selected={selected || undefined}
    >
      <header>
        <div className="production-card-title">
          <span className={`production-state state-${state}`}>{t(`ws.queue.state.${state}`)}</span>
          {renaming ? (
            <InlineTitle
              autoFocus
              onCancel={() => setRenaming(false)}
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
        <span>{t('ws.queue.metaService')}</span>
      </p>
      <div className={`production-strip ${panels.length > 48 ? 'dense' : ''}`} aria-hidden="true">
        {panels.map((p) => (
          <i key={p.id} className={`seg-${pageOf(p.id!).state}`} />
        ))}
      </div>
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
              disabled={render.isPending || retry.isPending || control.isPending || !episode}
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
      <div className="production-card-actions">
        {state === 'running' ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              Promise.all(
                task.jobs.map((j) => control.mutateAsync({ id: j.id, action: 'pause' })),
              ).catch(toastError)
            }
          >
            <Icon name="pause" />
            {t('ws.queue.pause')}
          </button>
        ) : state === 'paused' ? (
          <button
            type="button"
            className="btn"
            onClick={() =>
              Promise.all(
                task.jobs.map((j) => control.mutateAsync({ id: j.id, action: 'resume' })),
              ).catch(toastError)
            }
          >
            <Icon name="play" />
            {t('ws.queue.resume')}
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={!episode || state === 'done' || render.isPending}
            onClick={() => start()}
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
        <button
          type="button"
          className="btn ghost small production-clone"
          disabled={!episode || clone.isPending}
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
        <span className="grow" />
        <button
          type="button"
          className="btn ghost small production-remove"
          disabled={!task.ready || trash.isPending || control.isPending}
          onClick={async () => {
            if (
              await confirm({
                title: t('ws.queue.removeConfirm', { title: album.title }),
                description: t('ws.queue.removeHelp'),
                danger: true,
              })
            ) {
              try {
                await Promise.all(
                  task.jobs.map((j) => control.mutateAsync({ id: j.id, action: 'cancel' })),
                );
                await trash.mutateAsync(album.id!);
              } catch (error) {
                toastError(error);
              }
            }
          }}
        >
          <Icon name="trash" sm />
          {t('ws.queue.remove')}
        </button>
      </div>
      <details className="production-pages" open={failure ? true : undefined}>
        <summary>{t('ws.queue.pages')}</summary>
        <div className="production-page-list">
          {panels.map((p, i) => {
            const page = pageOf(p.id!);
            const st = page.state;
            const busy = st === 'running' || st === 'queued';
            const tries = episode?.takes.filter((x) => x.panel_id === p.id).length ?? 0;
            const again = !!page.asset;
            const tailAgain = panels.slice(i).some((x) => adopted.has(x.id!));
            return (
              <div className="production-page" key={p.id}>
                <div className="production-page-number">{String(i + 1).padStart(2, '0')}</div>
                {page.asset ? (
                  <button
                    type="button"
                    className="production-page-preview"
                    aria-label={t('ws.queue.previewOf', { n: i + 1 })}
                    title={t('ws.queue.previewOf', { n: i + 1 })}
                    onClick={() => setPreview({ asset: page.asset!, n: i + 1 })}
                  >
                    <img src={assetUrl(page.asset, 160)} alt="" loading="lazy" />
                  </button>
                ) : (
                  <span className="production-page-blank" />
                )}
                <div className="grow production-page-main">
                  <button
                    type="button"
                    className="production-page-body"
                    disabled={st === 'running'}
                    title={st === 'running' ? t('ws.queue.pageBusy') : t('ws.queue.pageEdit')}
                    onClick={() =>
                      navigate(`/workshop/assembly/${episode!.id}/script?panel=${p.id}`)
                    }
                  >
                    <span className="production-page-status">
                      <strong className={`page-${st}`}>{t(`ws.queue.state.${st}`)}</strong>
                      <small>{t('ws.queue.tries', { count: tries })}</small>
                    </span>
                    <span className="production-page-excerpt">
                      <b>{p.description || t('ws.story.frameN', { n: i + 1 })}</b>
                      <span className="production-page-prompt">
                        {(p.overrides.raw_prompt ?? p.tags.join(', ')).slice(0, 80)}
                      </span>
                    </span>
                  </button>
                  {page.error && st !== 'done' ? (
                    <p className="production-error">{page.error.message}</p>
                  ) : page.error ? (
                    <p className="production-error-tail" title={page.error.message}>
                      {t('ws.queue.keptOriginal')}
                    </p>
                  ) : null}
                </div>
                <div>
                  <button
                    type="button"
                    className="btn small"
                    disabled={render.isPending || busy}
                    title={again ? t('ws.queue.rerunHint') : undefined}
                    onClick={() => rerun([p.id!])}
                  >
                    <Icon name={again ? 'refresh' : 'play'} sm />
                    {again ? t('ws.queue.rerunOne') : t('ws.queue.runOne')}
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={render.isPending || busy}
                    onClick={() => rerun(panels.slice(i).map((x) => x.id!))}
                  >
                    <Icon name="list" sm />
                    {tailAgain ? t('ws.queue.rerunFrom') : t('ws.queue.runFrom')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </details>
      {preview ? (
        <Modal
          open
          size="lg"
          onOpenChange={(open) => !open && setPreview(null)}
          title={`${album.title} · ${t('ws.story.frameN', { n: preview.n })}`}
        >
          <img
            className="production-page-full-image"
            src={assetUrl(preview.asset)}
            alt={t('ws.story.frameN', { n: preview.n })}
          />
        </Modal>
      ) : null}
    </article>
  );
}
