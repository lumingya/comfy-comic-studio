import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type DragEvent as ReactDragEvent,
  type RefObject,
} from 'react';
import type { Selection } from './selection';

export interface SelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface SelectionHit {
  id: string;
  rect: SelectionRect;
}
export type MarqueeMode = 'replace' | 'add' | 'toggle';

/** Same rectangle semantics as the old desktop selector: touch an item to include it. */
export function marqueeIds(
  items: SelectionHit[],
  rect: SelectionRect,
  before: readonly string[],
  mode: MarqueeMode,
): string[] {
  const previous = new Set(before);
  const next = new Set(mode === 'replace' ? [] : previous);
  for (const item of items) {
    const b = item.rect;
    if (rect.left < b.right && rect.right > b.left && rect.top < b.bottom && rect.bottom > b.top) {
      if (mode === 'toggle' && previous.has(item.id)) next.delete(item.id);
      else next.add(item.id);
    }
  }
  return [...next];
}

const scrollHost = (root: HTMLElement): HTMLElement => {
  for (let el: HTMLElement | null = root; el; el = el.parentElement) {
    if (
      el.scrollHeight > el.clientHeight + 2 &&
      /(auto|scroll)/.test(getComputedStyle(el).overflowY)
    )
      return el;
  }
  return (document.scrollingElement as HTMLElement) || document.documentElement;
};

interface Options {
  root: RefObject<HTMLDivElement | null>;
  selection: Selection;
  enabled: boolean;
  canStart: (target: Element) => boolean;
  onStart: () => void;
}
interface Gesture {
  pointer: number;
  root: HTMLElement;
  scroll: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  scrollX: number;
  scrollY: number;
  before: string[];
  mode: MarqueeMode;
  box: HTMLDivElement | null;
}

/** Opt-in marquee; touch scrolling, controls and all other screens keep their own gestures. */
export function useMarquee(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const raf = useRef(0);
  const suppress = useRef(false);
  // Keep status/hint layout unchanged during a drag, as the old selector's paint/commit did.
  const [snapshot, setSnapshot] = useState<string[] | null>(null);
  const finishRef = useRef<(cancel: boolean) => void>(() => {});

  useEffect(() => {
    const dispose = (g: Gesture) => {
      cancelAnimationFrame(raf.current);
      g.box?.remove();
      document.body.classList.remove('shelf-marquee-active');
      if (g.root.hasPointerCapture?.(g.pointer)) g.root.releasePointerCapture(g.pointer);
    };
    const finish = (cancel: boolean) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      dispose(g);
      if (cancel) suppress.current = true;
      if (g.box) {
        suppress.current = true;
        if (cancel) latest.current.selection.replace(g.before);
        setSnapshot(null);
      }
    };
    finishRef.current = finish;
    const paint = () => {
      const g = gesture.current;
      if (!g?.box) return;
      const bounds =
        g.scroll === document.scrollingElement || g.scroll === document.documentElement
          ? { top: 0, bottom: window.innerHeight }
          : g.scroll.getBoundingClientRect();
      const speed =
        g.y < bounds.top + 36
          ? -Math.ceil((bounds.top + 36 - g.y) / 4)
          : g.y > bounds.bottom - 36
            ? Math.ceil((g.y - bounds.bottom + 36) / 4)
            : 0;
      g.scroll.scrollTop += Math.max(-22, Math.min(22, speed));
      const x = g.startX - (g.scroll.scrollLeft - g.scrollX);
      const y = g.startY - (g.scroll.scrollTop - g.scrollY);
      const rect = {
        left: Math.min(x, g.x),
        right: Math.max(x, g.x),
        top: Math.min(y, g.y),
        bottom: Math.max(y, g.y),
      };
      const clip = g.root.getBoundingClientRect();
      const left = Math.max(rect.left, clip.left),
        top = Math.max(rect.top, clip.top, bounds.top);
      Object.assign(g.box.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(0, Math.min(rect.right, clip.right) - left)}px`,
        height: `${Math.max(0, Math.min(rect.bottom, clip.bottom, bounds.bottom) - top)}px`,
      });
      const items = [...g.root.querySelectorAll<HTMLElement>('[data-shelf-id]')].map((el) => ({
        id: el.dataset.shelfId!,
        rect: el.getBoundingClientRect(),
      }));
      latest.current.selection.replace(marqueeIds(items, rect, g.before, g.mode));
      raf.current = requestAnimationFrame(paint);
    };
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointer) return;
      if (!latest.current.enabled) {
        finish(true);
        return;
      }
      g.x = e.clientX;
      g.y = e.clientY;
      if (!g.box && Math.hypot(g.x - g.startX, g.y - g.startY) > 5) {
        g.box = document.createElement('div');
        g.box.className = 'shelf-marquee';
        g.box.setAttribute('aria-hidden', 'true');
        document.body.append(g.box);
        document.body.classList.add('shelf-marquee-active');
        setSnapshot(g.before);
        latest.current.onStart();
        g.root.focus({ preventScroll: true });
        try {
          g.root.setPointerCapture?.(g.pointer);
        } catch {
          /* pointer already released */
        }
        paint();
      }
      if (g.box) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const up = (e: PointerEvent) => {
      if (gesture.current?.pointer === e.pointerId) finish(false);
    };
    const cancel = () => finish(true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      if (gesture.current) dispose(gesture.current);
      gesture.current = null;
    };
  }, []);

  return {
    snapshot,
    pending: () => !!gesture.current,
    cancel: () => finishRef.current(true),
    consumeClick: () => {
      const value = suppress.current;
      suppress.current = false;
      return value;
    },
    onDragStart: (e: ReactDragEvent) => {
      if (gesture.current) e.preventDefault();
    },
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      suppress.current = false;
      const { root, selection, enabled, canStart } = latest.current;
      if (
        !enabled ||
        !root.current ||
        e.button !== 0 ||
        e.pointerType === 'touch' ||
        !(e.target instanceof Element) ||
        !root.current.contains(e.target) ||
        !canStart(e.target)
      )
        return;
      const scroll = scrollHost(root.current);
      gesture.current = {
        pointer: e.pointerId,
        root: root.current,
        scroll,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        scrollX: scroll.scrollLeft,
        scrollY: scroll.scrollTop,
        before: [...selection.ids],
        mode: e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace',
        box: null,
      };
    },
  };
}
