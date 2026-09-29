import { useSelection } from '../../app/selection';
import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import {
  ContextMenu,
  useContextMenu,
  type ContextGroup,
  type ContextItem,
} from '../../components/ContextMenu';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl, data } from '../../api/client';
import { useJobControl, useJobs, useLive, useRetryJob } from '../../api/jobs';
import { keys } from '../../api/keys';
import { useRender, useRenderEpisode } from '../../api/production';
import { useProfiles } from '../../api/system';
import { useCloneTask, useQueue, useQueueAction } from '../../api/workshop';
import { usePatchSeries, useSeriesList, useTrashSeries } from '../../api/series';
import type { Episode, Job, QueueStatus, SeriesCard } from '../../api/types';
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
import {
  headlineTitle,
  moveId,
  orderByQueue,
  overridesSummary,
  pageNumbers,
  paging,
  shiftId,
  type OverridePart,
} from './queueView';

const ACTIVE = ACTIVE_JOB;
const MAX_CONCURRENCY = 128;
const isPaused = (j: Job) => !!j.paused || j.state === 'paused';

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
  /** Waiting in the server's sequential lane (1-based position, 0 = not queued). */
  position: number;
  /** The last run was stopped by the user and nothing runs now. */
  stopped: boolean;
}

/** What a card allows right now (legacy productionTaskAccess). */
function access(task: Task) {
  const busy = task.jobs.length > 0;
  const queued = task.position > 0;
  const canStart =
    !busy && !queued && task.state !== 'done' && task.ready && !!task.episode?.panels.length;
  return {
    busy,
    queued,
    canStart,
    canQueue: canStart,
    canPause: task.state === 'running',
    canResume: task.state === 'paused',
    canStop: busy,
  };
}

function useTasks(queue: QueueStatus | undefined) {
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
  const lane = queue?.lane ?? [];
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
    const state: Task['state'] = mine.some((j) => !isPaused(j))
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
    const position = mine.length ? 0 : lane.indexOf(album.id!) + 1;
    const stopped = !mine.length && recent[0]?.state === 'canceled' && state !== 'done';
    return { album, episode, jobs: mine, recent, adopted, state, ready, position, stopped };
  });
  return {
    tasks: orderByQueue(
      tasks,
      queue?.order,
      (x) => x.album.id!,
      (x) => x.album.created_at ?? '',
    ),
    isLoading: list.isLoading,
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

interface Drag {
  id: string;
  title: string;
  x: number;
  y: number;
  target: string | null;
  after: boolean;
}

type MenuPayload = DesktopContext;

/** 装配与队列: assembled albums waiting for 「开始生成」, with progress and partial reruns. */
export default function AssemblyTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => params.has('story') || params.has('new'));
  const queueQ = useQueue();
  const queue = queueQ.data;
  const act = useQueueAction();
  const { tasks, isLoading, error, retry } = useTasks(queue);
  const profiles = useProfiles();
  const control = useJobControl();
  const renderEpisode = useRenderEpisode();
  const clone = useCloneTask();
  const trash = useTrashSeries();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const taskIds = useMemo(() => tasks.map((task) => task.album.id!), [tasks]);
  const selection = useSelection(taskIds);
  const menu = useContextMenu<MenuPayload>();

  // A newly assembled task lands at the end: show the newest page again (legacy taskPage = ∞).
  const count = useRef(tasks.length);
  useEffect(() => {
    if (tasks.length > count.current) setPage(null);
    count.current = tasks.length;
  }, [tasks.length]);
  useEffect(() => {
    document.body.classList.toggle('production-reordering', !!drag);
    return () => document.body.classList.remove('production-reordering');
  }, [drag]);

  const auto = queue?.auto_concurrency ?? 1;
  const globalConcurrency = queue?.concurrency ?? auto;
  const running = tasks.filter((x) => x.jobs.length);
  const held = tasks.filter((x) => x.state === 'paused');
  const queued = tasks.filter((x) => x.position > 0);
  const lanePaused = !!queue?.paused;
  const sequenceable = tasks.filter((x) => access(x).canQueue);
  const done = tasks.filter((x) => x.state === 'done' && !x.position);
  const canPause = tasks.some((x) => x.state === 'running') || (queued.length > 0 && !lanePaused);
  const canResume = held.length > 0 || (queued.length > 0 && lanePaused);
  const canCancel = running.length + queued.length > 0;
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

  const byIds = (ids: string[]) => tasks.filter((task) => ids.includes(task.album.id!));
  const profileOf = (album: SeriesCard) => {
    const list = profiles.data ?? [];
    return (
      list.find((p) => p.id === album.default_profile_id) ??
      list.find((p) => p.id === 'profile_default') ??
      list[0]
    );
  };

  // ---------------------------------------------------------------- actions
  const startTask = async (task: Task, only?: string[]) => {
    const id = task.album.id!;
    if (!task.episode || starting.has(id)) return;
    const missing =
      only ?? task.episode.panels.filter((p) => !task.adopted.has(p.id!)).map((p) => p.id!);
    if (!missing.length) return;
    setStarting((s) => new Set(s).add(id));
    try {
      await renderEpisode.mutateAsync({
        episodeId: task.episode.id!,
        panel_ids: missing,
        candidates: 1,
        adopt_first: true,
      });
    } catch (e) {
      toastError(e);
    } finally {
      setStarting((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };
  const jobs = (list: Task[], action: 'pause' | 'resume' | 'cancel') =>
    Promise.all(
      list
        .flatMap((x) => x.jobs)
        .filter((j) =>
          action === 'pause' ? !isPaused(j) : action === 'resume' ? isPaused(j) : true,
        )
        .map((j) => control.mutateAsync({ id: j.id, action })),
    );
  const run = (p: Promise<unknown>) => void p.catch(toastError);
  const queueRun = (ids: string[]) => {
    if (!ids.length) return;
    act.mutate(
      { action: 'start', ids },
      {
        onSuccess: () => toast(t('ws.queue.sequenceStarted', { count: ids.length })),
        onError: toastError,
      },
    );
  };
  const dequeue = (task: Task) =>
    act.mutate({ action: 'remove', id: task.album.id! }, { onError: toastError });
  const reorder = (next: string[] | null) => {
    if (next) act.mutate({ action: 'order', ids: next }, { onError: toastError });
  };
  const pauseAll = () =>
    run(
      Promise.all([
        jobs(tasks, 'pause'),
        queued.length && !lanePaused ? act.mutateAsync({ action: 'pause' }) : null,
      ]),
    );
  const resumeAll = () =>
    run(
      Promise.all([
        jobs(tasks, 'resume'),
        lanePaused ? act.mutateAsync({ action: 'resume' }) : null,
      ]),
    );
  const cancelAll = async () => {
    if (!(await confirm({ title: t('ws.queue.cancelConfirm'), danger: true }))) return;
    run(Promise.all([act.mutateAsync({ action: 'clear' }), jobs(tasks, 'cancel')]));
  };
  const removeTasks = async (ids: string[]) => {
    const targets = byIds(ids);
    if (
      bulkBusy ||
      !targets.length ||
      targets.some((task) => !task.ready) ||
      !(await confirm({
        title:
          targets.length === 1
            ? t('ws.queue.removeConfirm', { title: targets[0].album.title })
            : t('classic.shelf.bulkDeleteTitle', { count: targets.length }),
        description: t('ws.queue.removeHelp'),
        danger: true,
      }))
    )
      return;
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
      for (const id of ids) {
        const out = await clone.mutateAsync(id);
        if (ids.length === 1) toast(t('ws.queue.cloned', { title: out.series.title }));
      }
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
  // Right-click on the empty part of the list: the page menu (legacy productionContextItems).
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    desktop.onContextMenu(e);
    if (e.defaultPrevented || !(e.target instanceof Element)) return;
    if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    e.preventDefault();
    menu.openAt(e.clientX, e.clientY, { ids: [], target: e.currentTarget });
  };

  // ---------------------------------------------------------------- drag to reorder
  const onGripDown = (e: ReactPointerEvent<HTMLElement>, task: Task) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    let state: Drag = {
      id: task.album.id!,
      title: task.album.title,
      x: e.clientX,
      y: e.clientY,
      target: null,
      after: false,
    };
    setDrag(state);
    menu.close();
    const move = (ev: PointerEvent) => {
      const hit = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-production-task]');
      const target = hit && hit.dataset.productionTask !== state.id ? hit : null;
      const box = target?.getBoundingClientRect();
      state = {
        ...state,
        x: ev.clientX,
        y: ev.clientY,
        target: target?.dataset.productionTask ?? null,
        after: box ? ev.clientY > box.top + box.height / 2 : false,
      };
      setDrag(state);
    };
    const end = (drop: boolean) => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      setDrag(null);
      if (drop && state.target) reorder(moveId(taskIds, state.id, state.target, state.after));
    };
    const up = () => end(true);
    const cancel = () => end(false);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
  };

  // ---------------------------------------------------------------- context menu
  const pageGroups = (): ContextGroup[] => [
    {
      items: [
        {
          label: t('ws.queue.new'),
          icon: <Icon name="plus" sm />,
          primary: true,
          onSelect: () => setOpen(true),
        },
        {
          label: t('ws.queue.sequence'),
          icon: <Icon name="list" sm />,
          disabled: !sequenceable.length,
          hint: sequenceable.length
            ? t('ws.queue.menu.sequenceHint', { count: sequenceable.length })
            : t('ws.queue.nothingSequence'),
          onSelect: () => queueRun(sequenceable.map((x) => x.album.id!)),
        },
      ],
    },
    {
      items: [
        {
          label: t('ws.queue.pauseAll'),
          icon: <Icon name="pause" sm />,
          disabled: !canPause,
          hint: t('ws.queue.menu.pauseAllHint'),
          onSelect: pauseAll,
        },
        {
          label: t('ws.queue.resumeAll'),
          icon: <Icon name="play" sm />,
          disabled: !canResume,
          hint: t('ws.queue.menu.resumeAllHint'),
          onSelect: resumeAll,
        },
        {
          label: t('ws.queue.menu.cancelAll'),
          icon: <Icon name="stop" sm />,
          danger: true,
          disabled: !canCancel,
          onSelect: () => void cancelAll(),
        },
      ],
    },
    {
      items: [
        {
          label: t('ws.queue.menu.selectAll'),
          icon: <Icon name="check" sm />,
          disabled: !tasks.length,
          onSelect: selection.all,
        },
      ],
    },
  ];
  const taskGroups = (task: Task): ContextGroup[] => {
    const a = access(task);
    const id = task.album.id!;
    const index = taskIds.indexOf(id);
    const last = taskIds.length - 1;
    const primary: ContextItem = a.canResume
      ? {
          label: t('ws.queue.resume'),
          icon: <Icon name="play" sm />,
          primary: true,
          hint: t('ws.queue.resumeHint'),
          onSelect: () => run(jobs([task], 'resume')),
        }
      : a.canPause
        ? {
            label: t('ws.queue.menu.pauseOne'),
            icon: <Icon name="pause" sm />,
            primary: true,
            hint: t('ws.queue.pauseHint'),
            onSelect: () => run(jobs([task], 'pause')),
          }
        : a.queued
          ? {
              label: t('ws.queue.dequeue'),
              icon: <Icon name="close" sm />,
              primary: true,
              hint: t('ws.queue.queuedAt', { n: task.position }),
              onSelect: () => dequeue(task),
            }
          : {
              label: t('ws.queue.start'),
              icon: <Icon name="play" sm />,
              primary: true,
              disabled: !a.canStart,
              onSelect: () => void startTask(task),
            };
    const move = (to: 'up' | 'down' | 'first' | 'last') => () => reorder(shiftId(taskIds, id, to));
    return [
      {
        items: [
          primary,
          ...(a.canStop
            ? [
                {
                  label: t('ws.queue.menu.stopOne'),
                  icon: <Icon name="stop" sm />,
                  hint: t('ws.queue.stopHint'),
                  onSelect: () => run(jobs([task], 'cancel')),
                },
              ]
            : []),
          ...(a.canQueue
            ? [
                {
                  label: t('ws.queue.menu.enqueue'),
                  icon: <Icon name="list" sm />,
                  hint: t('ws.queue.menu.enqueueHint'),
                  onSelect: () => queueRun([id]),
                },
              ]
            : []),
        ],
      },
      {
        items: [
          {
            label: t('ws.queue.clone'),
            icon: <Icon name="copy" sm />,
            disabled: bulkBusy || !task.episode,
            hint: t('ws.queue.cloneHint'),
            onSelect: () => void cloneTasks([id]),
          },
          {
            label: t('ws.queue.candidates'),
            icon: <Icon name="image" sm />,
            disabled: !task.episode,
            onSelect: () => navigate(`/workshop/assembly/${task.episode!.id}`),
          },
          {
            label: t('ws.queue.read'),
            icon: <Icon name="book" sm />,
            disabled: !task.adopted.size,
            onSelect: () => navigate(`/gallery/${id}`),
          },
        ],
      },
      {
        heading: t('ws.queue.menu.order'),
        note: t('ws.queue.menu.orderHint'),
        items: [
          {
            label: t('ws.queue.menu.up'),
            icon: <Icon name="up" sm />,
            disabled: index <= 0,
            onSelect: move('up'),
          },
          {
            label: t('ws.queue.menu.down'),
            icon: <Icon name="down" sm />,
            disabled: index < 0 || index >= last,
            onSelect: move('down'),
          },
          {
            label: t('ws.queue.menu.first'),
            icon: <Icon name="up" sm />,
            disabled: index <= 0,
            onSelect: move('first'),
          },
          {
            label: t('ws.queue.menu.last'),
            icon: <Icon name="down" sm />,
            disabled: index < 0 || index >= last,
            onSelect: move('last'),
          },
        ],
      },
      {
        items: [
          {
            label: t('ws.queue.menu.removeOne'),
            icon: <Icon name="trash" sm />,
            danger: true,
            disabled: bulkBusy || !task.ready,
            onSelect: () => void removeTasks([id]),
          },
        ],
      },
    ];
  };
  const selectionGroups = (ids: string[]): ContextGroup[] => {
    const picked = byIds(ids);
    const pick = (test: (a: ReturnType<typeof access>) => boolean) =>
      picked.filter((x) => test(access(x)));
    const startable = pick((a) => a.canStart);
    const pausable = pick((a) => a.canPause);
    const resumable = pick((a) => a.canResume);
    const stoppable = pick((a) => a.canStop);
    const entry = (
      label: string,
      icon: 'play' | 'list' | 'pause' | 'stop',
      list: Task[],
      onSelect: () => void,
      extra: Partial<ContextItem> = {},
    ): ContextItem[] =>
      list.length
        ? [
            {
              label: t(label, { count: list.length }),
              icon: <Icon name={icon} sm />,
              onSelect,
              ...extra,
            },
          ]
        : [];
    return [
      {
        items: [
          ...entry(
            'ws.queue.menu.startMany',
            'play',
            startable,
            () => startable.forEach((x) => void startTask(x)),
            {
              primary: true,
              hint: t('ws.queue.menu.startManyHint'),
            },
          ),
          ...entry(
            'ws.queue.menu.sequenceMany',
            'list',
            startable,
            () => queueRun(startable.map((x) => x.album.id!)),
            {
              hint: t('ws.queue.menu.sequenceManyHint'),
            },
          ),
        ],
      },
      {
        items: [
          ...entry('ws.queue.menu.pauseMany', 'pause', pausable, () =>
            run(jobs(pausable, 'pause')),
          ),
          ...entry('ws.queue.menu.resumeMany', 'play', resumable, () =>
            run(jobs(resumable, 'resume')),
          ),
          ...entry('ws.queue.menu.stopMany', 'stop', stoppable, () =>
            run(jobs(stoppable, 'cancel')),
          ),
        ],
      },
      {
        items: [
          {
            label: t('ws.queue.menu.cloneMany', { count: picked.length }),
            icon: <Icon name="copy" sm />,
            disabled: bulkBusy,
            onSelect: () => void cloneTasks(ids),
          },
          {
            label: t('ws.queue.menu.selectAll'),
            icon: <Icon name="check" sm />,
            onSelect: selection.all,
          },
          {
            label: t('ws.queue.menu.selectNone'),
            icon: <Icon name="close" sm />,
            onSelect: selection.clear,
          },
        ],
      },
      {
        items: [
          {
            label: t('ws.queue.menu.removeMany', { count: picked.length }),
            icon: <Icon name="trash" sm />,
            danger: true,
            disabled: bulkBusy || picked.some((x) => !x.ready),
            onSelect: () => void removeTasks(ids),
          },
        ],
      },
    ];
  };
  const menuGroups = (p: MenuPayload): ContextGroup[] => {
    if (!p.ids.length) return pageGroups();
    if (p.ids.length > 1) return selectionGroups(p.ids);
    const task = byIds(p.ids)[0];
    return task ? taskGroups(task) : pageGroups();
  };

  const view = paging(tasks.length, page);
  const shown = tasks.slice(view.start, view.end);
  const pageLabel = t('ws.queue.pager.label', { current: view.index + 1, total: view.pages });

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
      {queue?.fault ? (
        <div className="eco-safety danger" role="alert">
          <Icon name="disk" />
          <p>{t('ws.queue.storage', { message: queue.fault })}</p>
        </div>
      ) : null}
      {error || queueQ.error ? (
        <QueryError
          error={error || queueQ.error}
          onRetry={() => {
            retry();
            void queueQ.refetch();
          }}
        />
      ) : null}
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
          onContextMenu={onContextMenu}
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
                disabled={bulkBusy || byIds(selection.ids).some((task) => !task.ready)}
                onClick={() => void removeTasks(selection.ids)}
              >
                {t('common.delete')}
              </button>
              <button type="button" className="btn ghost small" onClick={selection.clear}>
                {t('common.cancel')}
              </button>
            </div>
          ) : null}
          {shown.map((task) => {
            const profile = profileOf(task.album);
            return (
              <TaskCard
                key={task.album.id}
                task={task}
                selected={selection.has(task.album.id!)}
                context={menu.state?.payload.focusId === task.album.id}
                profileName={profile?.name}
                overrides={(profile?.draft ?? [])
                  .filter((s) => s.enabled !== false)
                  .flatMap((s) => overridesSummary(s.overrides as Record<string, unknown>))}
                globalConcurrency={globalConcurrency}
                notice={queue?.notices?.[task.album.id!]}
                starting={starting.has(task.album.id!)}
                dragging={drag?.id === task.album.id}
                drop={drag?.target === task.album.id ? (drag.after ? 'after' : 'before') : null}
                onGripDown={(e) => onGripDown(e, task)}
                onStart={(only) => void startTask(task, only)}
                onPause={() => run(jobs([task], 'pause'))}
                onResume={() => run(jobs([task], 'resume'))}
                onStop={() => run(jobs([task], 'cancel'))}
                onDequeue={() => dequeue(task)}
                onRemove={() => void removeTasks([task.album.id!])}
                removing={bulkBusy}
              />
            );
          })}
        </div>
      ) : (
        <div className="eco-empty production-empty">
          <p>{t('ws.queue.empty')}</p>
        </div>
      )}
      {view.pages > 1 ? (
        <nav className="production-pager" aria-label={pageLabel}>
          <button
            type="button"
            className="btn ghost small"
            disabled={view.index === 0}
            onClick={() => setPage(view.index - 1)}
          >
            {t('ws.queue.pager.prev')}
          </button>
          <div className="production-pager-numbers">
            {pageNumbers(view.index, view.pages).map((i, k) =>
              i === null ? (
                <span key={`gap${k}`} className="production-pager-gap">
                  …
                </span>
              ) : (
                <button
                  key={i}
                  type="button"
                  className={`production-pager-number ${i === view.index ? 'active' : ''}`}
                  aria-current={i === view.index ? 'page' : undefined}
                  onClick={() => setPage(i)}
                >
                  {i + 1}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            className="btn ghost small"
            disabled={view.index === view.pages - 1}
            onClick={() => setPage(view.index + 1)}
          >
            {t('ws.queue.pager.next')}
          </button>
          <span className="production-pager-summary">
            {pageLabel} · {view.end - view.start > 1 ? `${view.start + 1}–${view.end}` : view.end} /{' '}
            {tasks.length}
          </span>
        </nav>
      ) : null}
      {drag ? (
        <div
          className="production-drag-ghost"
          aria-hidden="true"
          style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 12}px)` }}
        >
          ⠿ {drag.title}
        </div>
      ) : null}
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          returnFocus={menu.state.payload.target}
          onClose={menu.close}
          groups={menuGroups(menu.state.payload)}
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

/** Panel concurrency field; empty follows the default. An invalid value snaps back. */
function ConcurrencyInput({
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

function TaskCard({
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
  globalConcurrency: number;
  notice?: string;
  starting: boolean;
  dragging: boolean;
  drop: 'before' | 'after' | null;
  removing: boolean;
  onGripDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onStart: (only?: string[]) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDequeue: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album, episode, adopted, state } = task;
  const a = access(task);
  const render = useRender(episode?.id ?? '');
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
        <div className="production-card-title">
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
              <button
                type="button"
                className="btn"
                title={t('ws.queue.pauseHint')}
                onClick={onPause}
              >
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
          <button
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
      <details className="production-pages" open={failure ? true : undefined}>
        <summary>{t('ws.queue.pages')}</summary>
        <div className="production-page-list">
          {panels.map((p, i) => {
            const page = pageOf(p.id!);
            const st = page.state;
            // Legacy canRerun: a scene the engine still owns (running, queued or held) is not rerun.
            const busy = st === 'running' || st === 'queued' || st === 'paused';
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
