import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** Below this the press is a click; above it the album lifts (legacy THRESHOLD). */
const THRESHOLD = 8;
const CARD = '[data-shelf-id]';

interface Gesture {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  card: HTMLElement;
  active: boolean;
  target: string | null;
  after: boolean;
}

/**
 * Legacy shelf reordering (organize.js installShelfReorderDrag): press an album's ⠿ handle and
 * move 8px to lift it; a small copy of the cover follows the pointer, a bar marks where it will
 * land and the page scrolls near the edges.  Escape, leaving the window or a cancelled pointer
 * drops nothing.  Only the handle starts a drag — anywhere else the shelf draws its marquee.
 */
export function useShelfReorder(options: {
  root: RefObject<HTMLElement | null>;
  enabled: boolean;
  onDrop: (source: string, target: string, after: boolean) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (
      !latest.current.enabled ||
      e.button !== 0 ||
      e.pointerType === 'touch' ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const card = e.currentTarget.closest<HTMLElement>(CARD);
    const root = latest.current.root.current;
    if (!card || !root) return;
    e.preventDefault();
    cleanup.current?.();
    const g: Gesture = {
      id: card.dataset.shelfId!,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      card,
      active: false,
      target: null,
      after: false,
    };
    const scroller =
      root.closest<HTMLElement>('main') ?? (document.scrollingElement as HTMLElement | null);
    let ghost: HTMLElement | null = null;
    let raf = 0;

    const clearTargets = () =>
      root
        .querySelectorAll('.is-drop-target')
        .forEach((el) => el.classList.remove('is-drop-target', 'is-drop-after'));
    const makeGhost = () => {
      const cover = card.querySelector<HTMLElement>('.shelf-cover') ?? card;
      const rect = cover.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'shelf-drag-ghost';
      el.setAttribute('aria-hidden', 'true');
      const art = cover.querySelector('img, .parchment');
      if (art) {
        const copy = art.cloneNode(true) as HTMLElement;
        copy.removeAttribute('id');
        el.append(copy);
      }
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
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
      if (ghost) ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(x, y);
      if (ghost) ghost.style.visibility = '';
      const over = el?.closest<HTMLElement>(CARD);
      if (!over || !root.contains(over) || over.dataset.shelfId === g.id) return null;
      const r = over.getBoundingClientRect();
      return { card: over, after: x > r.left + r.width / 2 };
    };
    const track = (x: number, y: number) => {
      g.x = x;
      g.y = y;
      placeGhost(x, y);
      const h = hit(x, y);
      clearTargets();
      g.target = h?.card.dataset.shelfId ?? null;
      g.after = !!h?.after;
      if (h) {
        h.card.classList.add('is-drop-target');
        h.card.classList.toggle('is-drop-after', h.after);
      }
    };
    const tick = () => {
      if (!g.active || !scroller) return;
      const box = scroller.getBoundingClientRect(),
        top = Math.max(0, box.top) + 40,
        bottom = Math.min(window.innerHeight, box.bottom || window.innerHeight) - 64;
      const dy =
        g.y < top
          ? -Math.min(18, (top - g.y) / 3)
          : g.y > bottom
            ? Math.min(18, (g.y - bottom) / 3)
            : 0;
      if (dy) {
        scroller.scrollBy({ top: dy });
        track(g.x, g.y);
      }
      raf = requestAnimationFrame(tick);
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      ghost?.remove();
      ghost = null;
      clearTargets();
      card.classList.remove('is-dragging');
      document.body.classList.remove('shelf-reordering');
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', finish);
      cleanup.current = null;
    };
    // The click that follows a drop must not open (or deselect) anything.
    const swallowClick = () => {
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    };
    function move(ev: PointerEvent) {
      if (ev.pointerId !== g.pointerId) return;
      if (!(ev.buttons & 1)) return finish();
      if (!g.active) {
        if (Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < THRESHOLD) return;
        g.active = true;
        document.getSelection?.()?.removeAllRanges();
        ghost = makeGhost();
        g.card.classList.add('is-dragging');
        document.body.classList.add('shelf-reordering');
        raf = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      track(ev.clientX, ev.clientY);
    }
    function up(ev: PointerEvent) {
      if (ev.pointerId !== g.pointerId) return;
      const { active, target, after } = g;
      finish();
      if (!active) return;
      swallowClick();
      if (target && target !== g.id) latest.current.onDrop(g.id, target, after);
    }
    function key(ev: KeyboardEvent) {
      if (ev.key !== 'Escape' || !g.active) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish();
    }
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', finish);
    cleanup.current = finish;
  };

  return { onPointerDown };
}
