import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, data } from '../../api/client';
import { useJobControl, useJobs } from '../../api/jobs';
import { keys } from '../../api/keys';
import { useRender } from '../../api/production';
import { usePatchSeries, useSeriesList, useTrashSeries } from '../../api/series';
import type { Episode, Job, SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import AssembleDialog from './AssembleDialog';
import { WorkshopFrame } from './WorkshopPage';

const ACTIVE = ['queued', 'running', 'paused', 'blocked'];

export interface Task {
  album: SeriesCard;
  episode: Episode | undefined;
  jobs: Job[];
  adopted: Set<string>;
  state: 'standby' | 'running' | 'paused' | 'done';
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
  const jobs = useJobs(undefined, true);
  const tasks: Task[] = albums.map((album, i) => {
    const episode = episodes[i]?.data;
    const mine = (jobs.data ?? []).filter(
      (j) => j.owner === episode?.id && ACTIVE.includes(j.state),
    );
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
          : 'standby';
    return { album, episode, jobs: mine, adopted, state };
  });
  return { tasks, isLoading: list.isLoading, jobs: jobs.data ?? [] };
}

/** 装配与队列: assembled albums waiting for 「开始生成」, with progress and partial reruns. */
export default function AssemblyTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => params.has('story') || params.has('new'));
  const { tasks, isLoading, jobs } = useTasks();
  const control = useJobControl();
  const active = jobs.filter(
    (j) => ACTIVE.includes(j.state) && tasks.some((x) => x.episode?.id === j.owner),
  );
  const running = active.filter((j) => !j.paused && j.state !== 'paused');
  const paused = active.filter((j) => j.paused || j.state === 'paused');
  const done = tasks.filter((x) => x.state === 'done');
  const [sequence, setSequence] = useState(false);

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
        </div>
        <div className="production-toolbar">
          <button
            type="button"
            className="btn"
            disabled={!tasks.some((x) => x.state === 'standby') || sequence}
            onClick={() => setSequence(true)}
          >
            <Icon name="list" />
            {t('ws.queue.sequence')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!running.length}
            title={running.length ? undefined : t('ws.queue.nothingRunning')}
            onClick={() => each(running, 'pause')}
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
              if (await confirm({ title: t('ws.queue.cancelConfirm'), danger: true }))
                each(active, 'cancel');
            }}
          >
            <Icon name="stop" />
            {t('ws.queue.cancelAll')}
          </button>
          <ClearFinished done={done} />
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : tasks.length ? (
        <div className="production-cards">
          {tasks.map((task, i) => (
            <TaskCard
              key={task.album.id}
              task={task}
              autostart={
                sequence &&
                tasks.slice(0, i).every((x) => x.state !== 'standby' && x.state !== 'running')
              }
              onStarted={() => {
                if (!tasks.slice(i + 1).some((x) => x.state === 'standby')) setSequence(false);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="eco-empty production-empty">
          <p>{t('ws.queue.empty')}</p>
        </div>
      )}
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
}: {
  task: Task;
  autostart: boolean;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album, episode, adopted, state } = task;
  const render = useRender(episode?.id ?? '');
  const trash = useTrashSeries();
  const patch = usePatchSeries(album.id!);
  const control = useJobControl();
  const [renaming, setRenaming] = useState(false);
  const panels = useMemo(
    () => [...(episode?.panels ?? [])].sort((a, b) => a.order - b.order),
    [episode?.panels],
  );
  const busy = new Set(
    task.jobs.length ? panels.filter((p) => !adopted.has(p.id!)).map((p) => p.id!) : [],
  );
  const start = (ids?: string[]) => {
    const missing = ids ?? panels.filter((p) => !adopted.has(p.id!)).map((p) => p.id!);
    if (!missing.length) return;
    render.mutate(
      { panel_ids: missing, candidates: 1, adopt_first: true },
      { onSuccess: onStarted, onError: toastError },
    );
  };
  const ready = autostart && state === 'standby' && !!episode && render.isIdle;
  useEffect(() => {
    if (ready) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <article className="production-card" data-production-task={album.id}>
      <header>
        <div className="production-card-title">
          <span className={`production-state state-${state}`}>{t(`ws.queue.state.${state}`)}</span>
          {renaming ? (
            <input
              autoFocus
              defaultValue={album.title}
              aria-label={t('ws.queue.rename')}
              onBlur={(e) => {
                const title = e.target.value.trim();
                if (title && title !== album.title)
                  patch.mutate({ title }, { onError: toastError });
                setRenaming(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
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
        {album.subtitle ? (
          <span>{t('ws.queue.metaPresets', { titles: album.subtitle })}</span>
        ) : null}
        <span>{t('ws.queue.metaService')}</span>
      </p>
      <div className="production-strip" aria-hidden="true">
        {panels.map((p) => (
          <i
            key={p.id}
            className={
              adopted.has(p.id!) ? 'seg-done' : busy.has(p.id!) ? 'seg-running' : 'seg-standby'
            }
          />
        ))}
      </div>
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
        <span className="grow" />
        <button
          type="button"
          className="btn ghost small production-remove"
          onClick={async () => {
            if (
              await confirm({
                title: t('ws.queue.removeConfirm', { title: album.title }),
                description: t('ws.queue.removeHelp'),
                danger: true,
              })
            ) {
              await Promise.all(
                task.jobs.map((j) => control.mutateAsync({ id: j.id, action: 'cancel' })),
              );
              trash.mutate(album.id!, { onError: toastError });
            }
          }}
        >
          <Icon name="trash" sm />
          {t('ws.queue.remove')}
        </button>
      </div>
      <details className="production-pages">
        <summary>{t('ws.queue.pages')}</summary>
        <div className="production-page-list">
          {panels.map((p, i) => {
            const st = adopted.has(p.id!) ? 'done' : busy.has(p.id!) ? 'running' : 'standby';
            const tries = episode?.takes.filter((x) => x.panel_id === p.id).length ?? 0;
            return (
              <div className="production-page" key={p.id}>
                <div className="production-page-number">{String(i + 1).padStart(2, '0')}</div>
                <span className="production-page-blank" />
                <div className="grow production-page-main">
                  <button
                    type="button"
                    className="production-page-body"
                    title={t('ws.queue.pageEdit')}
                    onClick={() => navigate(`/workshop/assembly/${episode!.id}/script`)}
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
                </div>
                <div>
                  <button
                    type="button"
                    className="btn small"
                    disabled={render.isPending}
                    onClick={() =>
                      render.mutate(
                        { panel_ids: [p.id!], candidates: 1, adopt_first: true },
                        { onError: toastError },
                      )
                    }
                  >
                    <Icon name="play" sm />
                    {t('ws.queue.runOne')}
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={render.isPending}
                    onClick={() => start(panels.slice(i).map((x) => x.id!))}
                  >
                    <Icon name="down" sm />
                    {t('ws.queue.runFrom')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </article>
  );
}
