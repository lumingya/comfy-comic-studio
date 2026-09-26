import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import { confirm } from '../components/confirm';
import { toastError } from '../components/toast';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/** Ask the browser to confirm closing / reloading the tab while `active()` is true. */
function useBeforeUnload(active: () => boolean) {
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!active()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

/**
 * Debounced autosave for a local draft.  Call `touch()` after every edit; `save` always sees the
 * latest render's draft.  Saves never overlap (the next one waits), a pending edit is flushed when
 * the editor unmounts (switching panels / tabs), and closing the tab asks first.
 */
export function useAutosave(save: () => Promise<unknown>, delay = 800) {
  const [state, setState] = useState<SaveState>('idle');
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirty = useRef(false);
  const running = useRef<Promise<unknown> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    while (running.current) await running.current.catch(() => undefined);
    if (!dirty.current) return;
    dirty.current = false;
    setState('saving');
    const run = saveRef.current();
    running.current = run;
    try {
      await run;
      setState(dirty.current ? 'pending' : 'saved');
    } catch (error) {
      dirty.current = true;
      setState('error');
      throw error;
    } finally {
      running.current = null;
    }
  }, []);

  const touch = useCallback(() => {
    dirty.current = true;
    setState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush().catch(toastError), delay);
  }, [delay, flush]);

  /** Drop pending edits (e.g. the item was deleted). */
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    dirty.current = false;
    setState('idle');
  }, []);

  const busy = useCallback(() => dirty.current || running.current !== null, []);

  useEffect(
    () => () => {
      if (dirty.current) flush().catch(toastError);
    },
    [flush],
  );
  useBeforeUnload(busy);

  return { state, touch, flush, discard, busy };
}

/** For editors with an explicit Save: confirm before leaving the route with unsaved changes. */
export function useUnsavedGuard(dirty: boolean) {
  const { t } = useTranslation();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const latest = useRef(blocker);
  latest.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirm({
      title: t('common.unsavedTitle'),
      description: t('common.unsavedBody'),
      confirmLabel: t('common.leave'),
      danger: true,
    }).then((leave) => (leave ? latest.current.proceed?.() : latest.current.reset?.()));
  }, [blocker.state, t]);
  const active = useCallback(() => dirty, [dirty]);
  useBeforeUnload(active);
}
