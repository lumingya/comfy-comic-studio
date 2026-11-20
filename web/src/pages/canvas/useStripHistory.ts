import { useRef, useState } from 'react';
import type { Strip } from '../../api/types';

const LIMIT = 100;
const same = (a: Strip, b: Strip) => JSON.stringify(a) === JSON.stringify(b);
interface History {
  past: Strip[];
  present: Strip;
  future: Strip[];
  saved: Strip;
  baseRevision: number;
}

export interface StripSnapshot {
  strip: Strip;
  baseRevision: number;
}

/** Local undo history and the last acknowledged save are separate: undo can cross a save. */
export function useStripHistory(initial: Strip, revision: number) {
  const ref = useRef<History>({
    past: [],
    present: initial,
    future: [],
    saved: initial,
    baseRevision: revision,
  });
  const [state, setState] = useState(ref.current);
  const update = (next: History) => {
    ref.current = next;
    setState(next);
  };
  return {
    strip: state.present,
    dirty: !same(state.present, state.saved),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    current: () => ref.current.present,
    snapshot: (): StripSnapshot => ({
      strip: ref.current.present,
      baseRevision: ref.current.baseRevision,
    }),
    change: (next: Strip) => {
      const h = ref.current;
      if (same(h.present, next)) return;
      update({ ...h, past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] });
    },
    undo: () => {
      const h = ref.current;
      const prev = h.past.at(-1);
      if (prev)
        update({
          ...h,
          past: h.past.slice(0, -1),
          present: prev,
          future: [h.present, ...h.future],
        });
    },
    redo: () => {
      const h = ref.current;
      const next = h.future[0];
      if (next)
        update({ ...h, past: [...h.past, h.present], present: next, future: h.future.slice(1) });
    },
    acknowledge: (snapshot: StripSnapshot, stored: Strip) => {
      const h = ref.current;
      if (h.baseRevision !== snapshot.baseRevision) return;
      const canonical = (s: Strip) => (same(s, snapshot.strip) ? stored : s);
      update({
        past: h.past.map(canonical),
        present: canonical(h.present),
        future: h.future.map(canonical),
        saved: stored,
        // Both canvas writes CAS this revision and commit exactly one episode update.
        baseRevision: snapshot.baseRevision + 1,
      });
    },
    receive: (stored: Strip, revision: number) => {
      const h = ref.current;
      // Dirty drafts own their baseline. Late props from before an acknowledgement are stale.
      if (!same(h.present, h.saved) || revision < h.baseRevision) return false;
      if (revision === h.baseRevision) return same(h.saved, stored);
      if (same(h.saved, stored)) update({ ...h, baseRevision: revision });
      else update({ past: [], present: stored, future: [], saved: stored, baseRevision: revision });
      return true;
    },
  };
}
