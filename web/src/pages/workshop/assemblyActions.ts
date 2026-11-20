import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useJobControl } from '../../api/jobs';
import { useRenderEpisode } from '../../api/production';
import { useCloneTask, useQueueAction } from '../../api/workshop';
import { useTrashSeries } from '../../api/series';
import type { QueueStatus } from '../../api/types';
import type { Selection } from '../../app/selection';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { assemblyQueueState, isPaused, type Task } from './assemblyTasks';

export type AssemblyActions = ReturnType<typeof useAssemblyActions>;

/** Queue mutations and their pending state share one owner. */
export function useAssemblyActions(
  tasks: Task[],
  queue: QueueStatus | undefined,
  selection: Selection,
) {
  const { t } = useTranslation();
  const act = useQueueAction();
  const control = useJobControl();
  const renderEpisode = useRenderEpisode();
  const clone = useCloneTask();
  const trash = useTrashSeries();
  const [starting, setStarting] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { queued, lanePaused } = assemblyQueueState(tasks, queue);
  const byIds = (ids: string[]) => tasks.filter((task) => ids.includes(task.album.id!));
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
    act.mutate(
      { action: 'remove', id: task.album.id! },
      {
        onError: toastError,
        // The button is replaced: keep the keyboard on this card.
        onSuccess: () => {
          if (document.activeElement === document.body)
            document
              .querySelector<HTMLElement>(`[data-production-task="${task.album.id}"]`)
              ?.focus({ preventScroll: true });
        },
      },
    );
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

  return {
    act,
    starting,
    bulkBusy,
    byIds,
    startTask,
    jobs,
    run,
    queueRun,
    dequeue,
    reorder,
    pauseAll,
    resumeAll,
    cancelAll,
    removeTasks,
    cloneTasks,
  };
}
