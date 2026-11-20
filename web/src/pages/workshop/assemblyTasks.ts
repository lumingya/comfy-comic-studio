import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api, data } from '../../api/client';
import { useJobs } from '../../api/jobs';
import { keys } from '../../api/keys';
import { useSeriesList } from '../../api/series';
import type { Episode, Job, QueueStatus, SeriesCard } from '../../api/types';
import { ACTIVE_JOB } from './taskProgress';
import { orderByQueue } from './queueView';

const ACTIVE = ACTIVE_JOB;
export const isPaused = (job: Job) => !!job.paused || job.state === 'paused';

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
export function access(task: Task) {
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

export function useAssemblyTasks(queue: QueueStatus | undefined) {
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

export function assemblyQueueState(tasks: Task[], queue: QueueStatus | undefined) {
  const auto = queue?.auto_concurrency ?? 1;
  const globalConcurrency = queue?.concurrency ?? auto;
  const running = tasks.filter((task) => task.jobs.length);
  const held = tasks.filter((task) => task.state === 'paused');
  const queued = tasks.filter((task) => task.position > 0);
  const lanePaused = !!queue?.paused;
  return {
    auto,
    globalConcurrency,
    running,
    held,
    queued,
    lanePaused,
    sequenceable: tasks.filter((task) => access(task).canQueue),
    done: tasks.filter((task) => task.state === 'done' && !task.position),
    canPause: tasks.some((task) => task.state === 'running') || (queued.length > 0 && !lanePaused),
    canResume: held.length > 0 || (queued.length > 0 && lanePaused),
    canCancel: running.length + queued.length > 0,
  };
}
