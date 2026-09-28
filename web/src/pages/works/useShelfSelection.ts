import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useMarquee } from '../../app/useMarquee';
import type { Selection } from '../../app/selection';

const ITEM = '[data-shelf-id]';
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const CONTROL = `${EDITABLE},button,a,[role="button"]`;
const canSelect = (el: Element) =>
  !el.closest(EDITABLE) && (!el.closest(CONTROL) || !!el.closest('[data-shelf-open]'));
const blocked = () =>
  !!document.querySelector('dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"]');

export interface ShelfContext {
  ids: string[];
  focusId?: string;
  target: HTMLElement;
}
interface Options {
  selection: Selection;
  enabled: boolean;
  pinned: boolean;
  contextOpen: boolean;
  onExit: () => void;
  onOpen: (id: string) => void;
  onDelete: (ids: string[]) => void;
  onContext: (x: number, y: number, target: ShelfContext) => void;
  onCloseContext: () => void;
}

/** Gallery-only interaction adapter. Right-click targets are not persistent selection. */
export function useShelfSelection(options: Options) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const [touch, setTouch] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(pointer: coarse)');
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const marquee = useMarquee({
    root: ref,
    selection: options.selection,
    enabled: options.enabled,
    canStart: canSelect,
    onStart: options.onCloseContext,
  });
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const focus = (el: HTMLElement | null = ref.current) => el?.focus({ preventScroll: true });
  const open = (id: string) => {
    const o = latest.current;
    o.onCloseContext();
    o.onExit();
    o.selection.anchorAt(id);
    o.onOpen(id);
  };
  const context = (target: HTMLElement, x: number, y: number, extend = false) => {
    const o = latest.current,
      id = target.dataset.shelfId;
    let ids = [...o.selection.ids];
    if (id) {
      if (extend) {
        ids = [...new Set([...ids, id])];
        o.selection.replace(ids);
      } else if (!o.selection.has(id)) {
        o.onExit();
        ids = [id];
      }
      o.selection.anchorAt(id);
    }
    if (!ids.length) return false;
    focus(target);
    o.onContext(x, y, { ids, focusId: id, target });
    return true;
  };
  const actionsRef = useRef({ open, context });
  actionsRef.current = { open, context };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = latest.current,
        root = ref.current;
      const el = e.target instanceof Element ? e.target : document.activeElement;
      if (
        !o.enabled ||
        !root ||
        e.defaultPrevented ||
        e.isComposing ||
        el?.closest(EDITABLE) ||
        o.contextOpen ||
        blocked()
      )
        return;
      if (
        e.key === 'Escape' &&
        (o.selection.ids.length || o.pinned || marqueeRef.current.pending())
      ) {
        e.preventDefault();
        e.stopPropagation();
        marqueeRef.current.cancel();
        o.onExit();
        focus();
        return;
      }
      if (marqueeRef.current.pending()) return;
      if (!root.contains(el) && !root.contains(document.activeElement)) return;
      const item = el?.closest<HTMLElement>(ITEM);
      const id = item?.dataset.shelfId;
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        consume();
        o.selection.all();
        focus();
      } else if (
        e.key === 'Delete' &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        o.selection.ids.length
      ) {
        consume();
        if (!e.repeat) o.onDelete(o.selection.ids);
      } else if (e.key === ' ' && id && el && canSelect(el)) {
        consume();
        if (!e.repeat) o.selection.click(id, e.shiftKey ? e : { ctrlKey: true });
        focus(item);
      } else if (
        e.key === 'Enter' &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !el?.closest(CONTROL)
      ) {
        const target = id || (o.selection.ids.length === 1 ? o.selection.ids[0] : null);
        if (target) {
          consume();
          if (!e.repeat) actionsRef.current.open(target);
        }
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        const target = item || root,
          rect = target.getBoundingClientRect();
        if (actionsRef.current.context(target, rect.left + 12, rect.top + 12)) consume();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    ref,
    touch,
    snapshot: marquee.snapshot,
    onPointerDown: marquee.onPointerDown,
    onDragStartCapture: marquee.onDragStart,
    onClickCapture: (e: MouseEvent<HTMLDivElement>) => {
      const o = latest.current;
      if (
        !o.enabled ||
        e.button !== 0 ||
        !(e.target instanceof Element) ||
        !ref.current?.contains(e.target)
      )
        return;
      if (e.detail > 0 && marquee.consumeClick()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!canSelect(e.target)) return;
      const id = e.target.closest<HTMLElement>(ITEM)?.dataset.shelfId;
      if (!id) {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) o.onExit();
        focus();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.shiftKey || o.pinned) {
        o.selection.click(
          id,
          o.pinned && !e.ctrlKey && !e.metaKey && !e.shiftKey ? { ctrlKey: true } : e,
        );
        focus();
      } else open(id);
    },
    onContextMenu: (e: MouseEvent<HTMLDivElement>) => {
      if (
        !latest.current.enabled ||
        !(e.target instanceof Element) ||
        !ref.current?.contains(e.target) ||
        e.target.closest(EDITABLE)
      )
        return;
      const target = e.target.closest<HTMLElement>(ITEM) || ref.current;
      if (target && context(target, e.clientX, e.clientY, e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}
