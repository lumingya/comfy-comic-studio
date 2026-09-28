import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { confirm } from '../components/confirm';
import { toastError } from '../components/toast';
import { useAutosave } from './autosave';

export type AutosaveController = ReturnType<typeof useAutosave>;
const mountedEditors = new Set<AutosaveController>();
/** Commands that read saved data (export/copy/generate) first commit the active editor. */
export async function flushEditors(): Promise<void> {
  for (const editor of [...mountedEditors]) await flushDraft(editor);
}

/** Drain both the current request and any edits made while it was in flight. */
export async function flushDraft(save: AutosaveController): Promise<void> {
  while (save.busy()) await save.flush();
}

/** A single, synchronous draft ref prevents independent fields from overwriting each other. */
export function useAutoDraft<T>(initial: T, persist: (value: T) => Promise<unknown>, delay = 800) {
  const [value, setValue] = useState(initial);
  const current = useRef(value);
  const sender = useRef(persist);
  sender.current = persist;
  const save = useAutosave(() => sender.current(current.current), delay);
  const stamp = JSON.stringify(initial);
  useEffect(() => {
    if (!save.busy()) {
      current.current = initial;
      setValue(initial);
    }
    // Server echoes must never replace a newer local edit or a failed draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  const change = (next: T | ((previous: T) => T)) => {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(current.current) : next;
    current.current = value;
    setValue(value);
    save.touch();
  };
  return { ...save, value, change, read: () => current.current, flushAll: () => flushDraft(save) };
}

/** Save before route/tab changes; on failure retain the editor unless discard is confirmed. */
export function AutoSaveGuard({
  save,
  includeSearch = false,
}: {
  save: AutosaveController;
  includeSearch?: boolean;
}) {
  useEffect(() => {
    mountedEditors.add(save);
    return () => {
      mountedEditors.delete(save);
    };
  }, [save.flush]);
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <Guard save={save} includeSearch={includeSearch} /> : null;
}
function Guard({ save, includeSearch }: { save: AutosaveController; includeSearch: boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      save.busy() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        (includeSearch && currentLocation.search !== nextLocation.search)),
  );
  const latest = useRef({ save, blocker });
  latest.current = { save, blocker };
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    const leave = async () => {
      try {
        await flushDraft(latest.current.save);
        if (active) latest.current.blocker.proceed?.();
      } catch (error) {
        toastError(error);
        if (!active) return;
        const discard = await confirm({
          title: t('common.saveFailed'),
          description: t('common.unsavedBody'),
          confirmLabel: t('common.leave'),
          danger: true,
        });
        if (!active) return;
        if (discard) {
          latest.current.save.discard();
          latest.current.blocker.proceed?.();
        } else latest.current.blocker.reset?.();
      }
    };
    void leave();
    return () => {
      active = false;
    };
  }, [blocker.state, t]);
  return null;
}
