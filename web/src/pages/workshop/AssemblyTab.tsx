import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useSelection } from '../../app/selection';
import type { DesktopContext } from '../../app/useDesktopSelection';
import { ContextMenu, useContextMenu } from '../../components/ContextMenu';
import { useProfiles } from '../../api/system';
import { useQueue } from '../../api/workshop';
import type { SeriesCard, RenderProfile } from '../../api/types';
import { Icon } from '../../app/icons';
import { QueryError } from '../../app/errors';
import { Loading } from '../../components/ui';
import AssembleDialog from './AssembleDialog';
import { WorkshopFrame } from './WorkshopPage';
import { overridesSummary, pageNumbers, paging } from './queueView';
import { assemblyQueueState, useAssemblyTasks } from './assemblyTasks';
import { useAssemblyActions } from './assemblyActions';
import { useAssemblyInteraction } from './assemblyInteraction';
import { useAssemblyMenus } from './assemblyMenus';
import { AssemblyToolbar } from './AssemblyToolbar';
import { AssemblyTaskCard } from './AssemblyTaskCard';

export type { Task } from './assemblyTasks';
type MenuPayload = DesktopContext;

/** 装配与队列: assembled albums waiting for 「开始生成」, with progress and partial reruns. */
export default function AssemblyTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(() => params.has('story') || params.has('new'));
  const queueQ = useQueue();
  const queue = queueQ.data;
  const { tasks, isLoading, error, retry } = useAssemblyTasks(queue);
  const profiles = useProfiles();
  const taskIds = useMemo(() => tasks.map((task) => task.album.id!), [tasks]);
  const selection = useSelection(taskIds);
  const menu = useContextMenu<MenuPayload>();
  const actions = useAssemblyActions(tasks, queue, selection);
  const { starting, bulkBusy, byIds, startTask, jobs, run, dequeue, removeTasks, cloneTasks } =
    actions;
  const { page, setPage, drag, desktop, onContextMenu, onGripDown } = useAssemblyInteraction(
    tasks,
    taskIds,
    selection,
    menu,
    actions,
    params.get('task') ?? '',
  );
  const menuGroups = useAssemblyMenus(tasks, queue, selection, actions, setOpen);
  const { globalConcurrency } = assemblyQueueState(tasks, queue);
  const profileOf = (album: SeriesCard) => {
    if (album.generation?.profile) return album.generation.profile as unknown as RenderProfile;
    const list = profiles.data ?? [];
    return (
      list.find((profile) => profile.id === album.default_profile_id) ??
      list.find((profile) => profile.id === 'profile_default') ??
      list[0]
    );
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
      <AssemblyToolbar tasks={tasks} queue={queue} actions={actions} />
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
              <AssemblyTaskCard
                key={task.album.id}
                task={task}
                selected={selection.has(task.album.id!)}
                context={menu.state?.payload.focusId === task.album.id}
                profileName={profile?.name}
                overrides={(profile?.draft ?? [])
                  .filter((s) => s.enabled !== false)
                  .flatMap((s) => overridesSummary((s.overrides ?? {}) as Record<string, unknown>))}
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
            if (params.has('story') || params.has('new') || params.has('kit')) {
              params.delete('story');
              params.delete('new');
              params.delete('kit');
              setParams(params, { replace: true });
            }
          }}
        />
      ) : null}
    </WorkshopFrame>
  );
}
