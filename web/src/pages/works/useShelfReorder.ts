import {
  useEffect,
  useRef,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { shortcutBlocked } from '../../app/shortcuts';
import { useTranslation } from 'react-i18next';

/** Below this the press is a click; above it the album lifts (legacy THRESHOLD). */
const THRESHOLD = 6;
const CARD = '[data-shelf-id]';
const COLLECTION = '[data-shelf-collection]';
const CONTROL = 'input,textarea,select,[contenteditable],button,a,[role="button"],summary,label';
const REORDER_SHORTCUTS = 'Shift+Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape';

interface Gesture {
  id: string;
  moving: string[];
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  card: HTMLElement;
  active: boolean;
  target: HTMLElement | null;
  collectionTarget: boolean;
  after: boolean;
  sortable: boolean;
}

interface KeyboardGesture {
  id: string;
  moving: string[];
  source: HTMLElement;
  target: HTMLElement;
  after: boolean;
  slot: number;
  startSlot: number;
  status: HTMLElement;
}

/**
 * Press the cover or card body and move 6px to lift the album. Blank shelf space owns marquee.
 * Selection mode keeps its chosen albums and suppresses a drag's release click, so it
 * cannot accidentally open, deselect or reorder a single album from a group.
 */
export function useShelfReorder(options: {
  root: RefObject<HTMLElement | null>;
  targetsRoot?: RefObject<HTMLElement | null>;
  enabled: boolean;
  canDrag?: boolean;
  sortable: boolean;
  selectedIds?: readonly string[];
  onDrop: (source: string, target: string, after: boolean, moving?: string[]) => void;
  onCollectionDrop?: (moving: string[], collectionId: string | null) => void;
}) {
  const { t } = useTranslation();
  const latest = useRef(options);
  latest.current = options;
  const cleanup = useRef<(() => void) | null>(null);
  const cancelGesture = useRef<(() => void) | null>(null);
  const keyboardGesture = useRef<KeyboardGesture | null>(null);
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const findCard = (root: HTMLElement, id: string) =>
    [...root.querySelectorAll<HTMLElement>(CARD)].find((el) => el.dataset.shelfId === id);
  const finishKeyboard = (restoreFocus: boolean) => {
    const g = keyboardGesture.current;
    if (!g) return;
    g.source.classList.remove('is-dragging');
    g.source.removeAttribute('aria-grabbed');
    g.target.classList.remove('is-drop-target', 'is-drop-after');
    g.status.remove();
    keyboardGesture.current = null;
    dragging.current = false;
    if (restoreFocus && g.source.isConnected) g.source.focus();
  };
  useEffect(() => {
    const root = latest.current.root.current;
    if (!root) return;
    const syncShortcut = (target: EventTarget | null, enabled: boolean) => {
      if (!(target instanceof Element)) return;
      const card = target.closest<HTMLElement>(CARD);
      if (!card || !root.contains(card)) return;
      if (
        enabled &&
        latest.current.enabled &&
        latest.current.canDrag !== false &&
        latest.current.sortable
      )
        card.setAttribute('aria-keyshortcuts', REORDER_SHORTCUTS);
      else card.removeAttribute('aria-keyshortcuts');
    };
    const onFocusIn = (event: FocusEvent) => syncShortcut(event.target, true);
    const onFocusOut = (event: FocusEvent) => {
      const oldCard =
        event.target instanceof Element ? event.target.closest<HTMLElement>(CARD) : null;
      const newCard =
        event.relatedTarget instanceof Element
          ? event.relatedTarget.closest<HTMLElement>(CARD)
          : null;
      if (oldCard !== newCard) syncShortcut(event.target, false);
      if (newCard && oldCard !== newCard) syncShortcut(event.relatedTarget, true);
    };
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    const focused = document.activeElement;
    syncShortcut(focused, true);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      cleanup.current?.();
      finishKeyboard(false);
    };
  }, []);
  useEffect(() => {
    const focused = document.activeElement;
    const card = focused instanceof Element ? focused.closest<HTMLElement>(CARD) : null;
    if (!card || !latest.current.root.current?.contains(card)) return;
    if (options.enabled && options.canDrag !== false && options.sortable)
      card.setAttribute('aria-keyshortcuts', REORDER_SHORTCUTS);
    else card.removeAttribute('aria-keyshortcuts');
  }, [options.enabled, options.canDrag, options.sortable]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const root = latest.current.root.current;
    if (!root) return;
    const active = keyboardGesture.current;
    if (!active && (!latest.current.enabled || latest.current.canDrag === false)) return;
    if (!active) {
      if (
        !latest.current.sortable ||
        (e.key !== ' ' && e.key !== 'Spacebar') ||
        !e.shiftKey ||
        e.target !== (e.target instanceof Element ? e.target.closest(CARD) : null) ||
        shortcutBlocked(e, root)
      )
        return;
      const source = e.target as HTMLElement;
      if (!source.isConnected || !root.contains(source)) return;
      const id = source.dataset.shelfId;
      if (!id) return;
      const selected = latest.current.selectedIds ?? [];
      const moving = selected.length > 1 && selected.includes(id) ? [...selected] : [id];
      const cards = [...root.querySelectorAll<HTMLElement>(CARD)];
      const remaining = cards.filter((card) => !moving.includes(card.dataset.shelfId ?? ''));
      if (!remaining.length) return;
      const sourceIndex = cards.indexOf(source);
      const slot = cards
        .slice(0, sourceIndex)
        .filter((card) => !moving.includes(card.dataset.shelfId ?? '')).length;
      const target = remaining[Math.min(slot, remaining.length - 1)];
      const after = slot >= remaining.length;
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.dataset.shelfReorderStatus = '';
      status.style.cssText =
        'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
      root.append(status);
      source.setAttribute('aria-grabbed', 'true');
      source.classList.add('is-dragging');
      target.classList.add('is-drop-target');
      target.classList.toggle('is-drop-after', after);
      const label =
        source.getAttribute('aria-label') ||
        source.querySelector('h1,h2,h3')?.textContent?.trim() ||
        id;
      status.textContent = t('classic.shelf.reorderPickedUp', { title: label });
      keyboardGesture.current = {
        id,
        moving,
        source,
        target,
        after,
        slot,
        startSlot: slot,
        status,
      };
      dragging.current = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finishKeyboard(true);
      return;
    }
    if (!(e.target instanceof Node) || !active.source.contains(e.target)) return;
    if (shortcutBlocked(e, root)) return;
    if (!latest.current.enabled || latest.current.canDrag === false) return;
    if ((e.key === ' ' || e.key === 'Spacebar') && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const { id, target, after, moving, slot, startSlot } = active;
      finishKeyboard(true);
      if (slot !== startSlot) latest.current.onDrop(id, target.dataset.shelfId!, after, moving);
      return;
    }
    const delta =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const cards = [...root.querySelectorAll<HTMLElement>(CARD)];
    const remaining = cards.filter((card) => !active.moving.includes(card.dataset.shelfId ?? ''));
    const nextSlot = Math.max(0, Math.min(remaining.length, active.slot + delta));
    if (nextSlot === active.slot) return;
    active.target.classList.remove('is-drop-target', 'is-drop-after');
    active.slot = nextSlot;
    active.target = remaining[Math.min(nextSlot, remaining.length - 1)];
    active.after = nextSlot >= remaining.length;
    active.target.classList.add('is-drop-target');
    active.target.classList.toggle('is-drop-after', active.after);
    active.status.textContent = t('classic.shelf.reorderMoving', {
      title: active.source.getAttribute('aria-label') || active.id,
      position: nextSlot + 1,
      total: remaining.length + active.moving.length,
    });
  };

  const onBlurCapture = (e: ReactFocusEvent<HTMLElement>) => {
    const active = keyboardGesture.current;
    if (active && !active.source.contains(e.relatedTarget as Node | null)) finishKeyboard(false);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (
      !latest.current.enabled ||
      latest.current.canDrag === false ||
      e.button !== 0 ||
      e.pointerType === 'touch' ||
      !(e.target instanceof Element)
    )
      return;
    const card = e.currentTarget.closest<HTMLElement>(CARD);
    const root = latest.current.root.current;
    if (!card || !root?.contains(card)) return;
    const control = e.target.closest(CONTROL);
    if (control && !control.matches('[data-shelf-open]')) return;
    const selectedIds = latest.current.selectedIds ?? [];
    const selectedDrag = selectedIds.length > 1 && selectedIds.includes(card.dataset.shelfId!);
    const moving = selectedDrag ? [...selectedIds] : [card.dataset.shelfId!];
    e.preventDefault();
    cleanup.current?.();
    const g: Gesture = {
      id: card.dataset.shelfId!,
      moving,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      card,
      active: false,
      target: null,
      collectionTarget: false,
      after: false,
      sortable:
        latest.current.sortable &&
        (!selectedIds.length || selectedDrag) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey,
    };
    const scroller =
      root.closest<HTMLElement>('main') ?? (document.scrollingElement as HTMLElement | null);
    let ghost: HTMLElement | null = null;
    let raf = 0;

    const clearTarget = () =>
      g.target?.classList.remove('is-drop-target', 'is-drop-after', 'is-collection-drop-target');
    const makeGhost = () => {
      const cover = card.querySelector<HTMLElement>('.shelf-cover, .exhibit-cover-link') ?? card;
      const rect = cover.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'shelf-drag-ghost';
      el.setAttribute('aria-hidden', 'true');
      const art = cover.querySelector('img, .parchment');
      if (art) {
        const copy = art.cloneNode(true) as HTMLElement;
        copy.removeAttribute('id');
        if (copy instanceof HTMLImageElement) {
          copy.loading = 'eager';
        }
        el.append(copy);
      }
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      if (g.moving.length > 1) el.dataset.count = String(g.moving.length);
      document.body.append(el);
      return el;
    };
    const placeGhost = (x: number, y: number) => {
      if (!ghost) return;
      const w = parseFloat(ghost.style.width) || 1,
        h = parseFloat(ghost.style.height) || 1,
        scale = Math.min(1, 150 / w);
      ghost.style.transform = `translate(${x - (w * scale) / 2}px, ${y - (h * scale) / 2}px) scale(${scale})`;
    };
    const hit = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      const collection = el?.closest<HTMLElement>(COLLECTION);
      const targetsRoot = latest.current.targetsRoot?.current ?? root;
      if (
        latest.current.onCollectionDrop &&
        collection &&
        targetsRoot.contains(collection) &&
        !collection.matches(':disabled,[aria-disabled="true"]')
      ) {
        return { card: collection, after: false, collection: true };
      }
      if (!g.sortable) return null;
      const over = el?.closest<HTMLElement>(CARD);
      if (over && root.contains(over) && !g.moving.includes(over.dataset.shelfId ?? '')) {
        const r = over.getBoundingClientRect();
        return { card: over, after: x > r.left + r.width / 2, collection: false };
      }
      // The marker sits in the gutter. Moving onto it must not cancel that drop target.
      if (g.target && !g.collectionTarget && !over && root.contains(el)) {
        const r = g.target.getBoundingClientRect();
        const distance = g.after ? x - r.right : r.left - x;
        if (y >= r.top && y <= r.bottom && distance >= 0 && distance <= 12) {
          return { card: g.target, after: g.after, collection: false };
        }
      }
      return null;
    };
    const track = (x: number, y: number) => {
      g.x = x;
      g.y = y;
      placeGhost(x, y);
      const h = hit(x, y);
      if (h && g.target === h.card && g.after === h.after) return;
      clearTarget();
      g.target = h?.card ?? null;
      g.after = !!h?.after;
      g.collectionTarget = !!h?.collection;
      if (h) {
        if (h.collection) h.card.classList.add('is-collection-drop-target');
        else {
          h.card.classList.add('is-drop-target');
          h.card.classList.toggle('is-drop-after', h.after);
        }
      }
    };
    const scheduleScroll = () => {
      if (raf || !scroller) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const box = scroller.getBoundingClientRect(),
          top = Math.max(0, box.top) + 40,
          bottom = Math.min(window.innerHeight, box.bottom || window.innerHeight) - 64;
        const dy =
          g.y < top
            ? -Math.min(18, (top - g.y) / 3)
            : g.y > bottom
              ? Math.min(18, (g.y - bottom) / 3)
              : 0;
        if (!dy) return;
        const before = scroller.scrollTop;
        scroller.scrollTop += dy;
        if (scroller.scrollTop === before) return;
        track(g.x, g.y);
        scheduleScroll();
      });
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      ghost?.remove();
      ghost = null;
      clearTarget();
      for (const id of g.moving) {
        findCard(root!, id)?.classList.remove('is-dragging');
      }
      document.body.classList.remove('shelf-reordering');
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', abort);
      cleanup.current = null;
      cancelGesture.current = null;
      dragging.current = false;
    };
    const abort = () => {
      suppressClick.current = true;
      finish();
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === g.pointerId) abort();
    };
    function move(ev: PointerEvent) {
      if (ev.pointerId !== g.pointerId) return;
      if (!(ev.buttons & 1) || !latest.current.enabled || latest.current.canDrag === false)
        return abort();
      if (!g.active) {
        if (Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < THRESHOLD) return;
        g.active = true;
        dragging.current = true;
        document.getSelection?.()?.removeAllRanges();
        if (g.sortable || latest.current.onCollectionDrop) {
          ghost = makeGhost();
          for (const id of g.moving) {
            findCard(root!, id)?.classList.add('is-dragging');
          }
          document.body.classList.add('shelf-reordering');
        }
      }
      ev.preventDefault();
      if (g.sortable || latest.current.onCollectionDrop) {
        track(ev.clientX, ev.clientY);
        scheduleScroll();
      }
    }
    function up(ev: PointerEvent) {
      if (ev.pointerId !== g.pointerId) return;
      const { active, after, collectionTarget } = g;
      const target = g.target?.dataset.shelfId;
      const collectionId = g.target?.dataset.shelfCollection;
      finish();
      if (!active) return;
      suppressClick.current = true;
      if (!latest.current.enabled || latest.current.canDrag === false) return;
      if (collectionTarget && collectionId !== undefined) {
        latest.current.onCollectionDrop?.(g.moving, collectionId || null);
      } else if (g.sortable && target && target !== g.id)
        latest.current.onDrop(g.id, target, after, g.moving);
    }
    function key(ev: KeyboardEvent) {
      if (ev.key !== 'Escape' || shortcutBlocked(ev, root, true)) return;
      // A drag owns the first Escape; the selection adapter receives the next one.
      ev.preventDefault();
      ev.stopImmediatePropagation();
      abort();
    }
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', abort);
    cleanup.current = finish;
    cancelGesture.current = abort;
  };

  return {
    cancel: () => {
      if (keyboardGesture.current) {
        finishKeyboard(true);
        return true;
      }
      if (!cancelGesture.current) return false;
      cancelGesture.current();
      return true;
    },
    isDragging: () => dragging.current,
    onBlurCapture,
    onKeyDown,
    onPointerDown,
    onPointerDownCapture: () => {
      suppressClick.current = false;
    },
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (!suppressClick.current || !e.detail) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
