import { useEffect, useState } from 'react';

function isModal(d: HTMLDialogElement) {
  try {
    return d.matches(':modal');
  } catch {
    return true; // engines without :modal (jsdom): treat every open <dialog> as modal
  }
}

/**
 * The topmost open modal `<dialog>` (the reader, 新建生成任务, …), or undefined.
 *
 * A modal dialog sits in the browser's top layer and makes the rest of the page inert, so toasts,
 * confirmations and menus portalled to `<body>` would render *behind* it and could not be clicked
 * (legacy moved `#toasts` into the open dialog for the same reason).
 */
export function topDialog(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter(isModal);
  return open.at(-1);
}

/** {@link topDialog}, kept up to date while `active` (dialogs opening / closing). */
export function useTopDialog(active = true): HTMLElement | undefined {
  const [, setHost] = useState<HTMLElement | undefined>(() => (active ? topDialog() : undefined));
  useEffect(() => {
    if (!active) return;
    const update = () => setHost(topDialog());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => observer.disconnect();
  }, [active]);
  // Resolve synchronously on the first open render. A portal briefly mounted outside an
  // existing native modal is inert and its autofocus can be refused by the browser.
  // The state above only invalidates this render when native modal ownership changes.
  return active ? topDialog() : undefined;
}
