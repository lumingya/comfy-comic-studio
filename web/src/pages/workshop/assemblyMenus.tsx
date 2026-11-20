import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { QueueStatus } from '../../api/types';
import { Icon } from '../../app/icons';
import type { Selection } from '../../app/selection';
import type { DesktopContext } from '../../app/useDesktopSelection';
import type { ContextGroup, ContextItem } from '../../components/ContextMenu';
import { shiftId } from './queueView';
import { access, assemblyQueueState, type Task } from './assemblyTasks';
import type { AssemblyActions } from './assemblyActions';

type MenuPayload = DesktopContext;

export function useAssemblyMenus(
  tasks: Task[],
  queue: QueueStatus | undefined,
  selection: Selection,
  actions: AssemblyActions,
  setOpen: (open: boolean) => void,
) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const taskIds = tasks.map((task) => task.album.id!);
  const { sequenceable, canPause, canResume, canCancel } = assemblyQueueState(tasks, queue);
  const {
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
  } = actions;
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
            },
          ),
          ...entry(
            'ws.queue.menu.sequenceMany',
            'list',
            startable,
            () => queueRun(startable.map((x) => x.album.id!)),
            {},
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

  return menuGroups;
}
