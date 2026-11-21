import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Selection } from '../../app/selection';
import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import { useContextMenu } from '../../components/ContextMenu';
import { moveId, PAGE_SIZE } from './queueView';
import type { AssemblyActions } from './assemblyActions';
import type { Task } from './assemblyTasks';

interface Drag {
  id: string;
  title: string;
  x: number;
  y: number;
  target: string | null;
  after: boolean;
}

export function useAssemblyInteraction(
  tasks: Task[],
  taskIds: string[],
  selection: Selection,
  menu: ReturnType<typeof useContextMenu<DesktopContext>>,
  actions: AssemblyActions,
  requestedTask: string,
) {
  const [page, setPage] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { removeTasks, reorder } = actions;
  const located = useRef('');
  useEffect(() => {
    if (!requestedTask || located.current === requestedTask) return;
    const index = taskIds.indexOf(requestedTask);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
  }, [requestedTask, taskIds]);
  useEffect(() => {
    if (!requestedTask || located.current === requestedTask) return;
    const card = Array.from(document.querySelectorAll<HTMLElement>('[data-production-task]')).find(
      (node) => node.dataset.productionTask === requestedTask,
    );
    if (!card) return;
    card.scrollIntoView?.({ block: 'nearest' });
    card.focus();
    const details = card.querySelector('details');
    if (details) details.open = true;
    located.current = requestedTask;
  }, [requestedTask, page, tasks]);

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

  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: true,
    pinned: false,
    marqueeFromBlankOnly: true,
    escapeFromFields: true,
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
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const grip = e.currentTarget;
    const { pointerId, clientX, clientY } = e;
    const fromHandle = grip.matches('.production-grip');
    if (fromHandle) {
      e.preventDefault();
      e.stopPropagation();
    }
    grip.setPointerCapture(e.pointerId);
    let state: Drag = {
      id: task.album.id!,
      title: task.album.title,
      x: e.clientX,
      y: e.clientY,
      target: null,
      after: false,
    };
    let active = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < 6) return;
        active = true;
        menu.close();
      }
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
      document.removeEventListener('keydown', key, true);
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      grip.removeEventListener('lostpointercapture', cancel);
      setDrag(null);
      if (active && drop && state.target)
        reorder(moveId(taskIds, state.id, state.target, state.after));
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    document.addEventListener('keydown', key, true);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
    grip.addEventListener('lostpointercapture', cancel);
  };

  return { page, setPage, drag, desktop, onContextMenu, onGripDown };
}
