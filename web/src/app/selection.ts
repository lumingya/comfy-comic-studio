import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Modifier keys of a click / keydown, normalised across platforms (⌘ counts as Ctrl). */
export interface Modifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export interface Selection {
  /** Selected ids in list order. */
  ids: string[];
  set: ReadonlySet<string>;
  has: (id: string) => boolean;
  /** Plain click = only this; Ctrl / ⌘ = toggle; Shift = range from the anchor. */
  click: (id: string, mods?: Modifiers) => void;
  toggle: (id: string) => void;
  only: (id: string) => void;
  all: () => void;
  clear: () => void;
  /** Right-click: keep a multi-selection when the target is part of it, else select the target. */
  contextTarget: (id: string) => string[];
}

/**
 * Multi-selection over an ordered id list (legacy 框选 / Ctrl 点选 / Shift 连选 model).
 * Ids that disappear from `order` (deleted panels) drop out of the selection automatically.
 */
export function useSelection(order: string[]): Selection {
  const [set, setSet] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  useEffect(() => {
    setSet((prev) => {
      const alive = new Set(order);
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [order]);

  const only = useCallback((id: string) => {
    anchor.current = id;
    setSet(new Set([id]));
  }, []);
  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const click = useCallback(
    (id: string, mods: Modifiers = {}) => {
      if (mods.shiftKey && anchor.current) {
        const ids = orderRef.current;
        const a = ids.indexOf(anchor.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [from, to] = a < b ? [a, b] : [b, a];
          const range = ids.slice(from, to + 1);
          setSet((prev) =>
            mods.ctrlKey || mods.metaKey ? new Set([...prev, ...range]) : new Set(range),
          );
          return;
        }
      }
      if (mods.ctrlKey || mods.metaKey) toggle(id);
      else only(id);
    },
    [only, toggle],
  );
  const all = useCallback(() => setSet(new Set(orderRef.current)), []);
  const clear = useCallback(() => {
    anchor.current = null;
    setSet(new Set());
  }, []);
  const contextTarget = useCallback(
    (id: string) => {
      if (set.has(id) && set.size > 1) return orderRef.current.filter((x) => set.has(x));
      only(id);
      return [id];
    },
    [set, only],
  );

  const ids = useMemo(() => order.filter((id) => set.has(id)), [order, set]);
  return useMemo(
    () => ({
      ids,
      set,
      has: (id: string) => set.has(id),
      click,
      toggle,
      only,
      all,
      clear,
      contextTarget,
    }),
    [ids, set, click, toggle, only, all, clear, contextTarget],
  );
}
