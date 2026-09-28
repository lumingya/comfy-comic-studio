/** Shared shortcut boundary: typing, IME, menus and unrelated modal layers own their keys. */
export function shortcutBlocked(
  event: {
    target: EventTarget | null;
    defaultPrevented: boolean;
    isComposing?: boolean;
    nativeEvent?: { isComposing?: boolean };
  },
  scope?: Element | null,
  allowTyping = false,
): boolean {
  if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing) return true;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (
    !allowTyping &&
    target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
  )
    return true;
  if (document.querySelector('[role="menu"]')) return true;
  const layers = [
    ...document.querySelectorAll(
      'dialog[open],[role="dialog"]:not([aria-hidden="true"]),[role="alertdialog"]',
    ),
  ];
  const top = layers.at(-1);
  const owner = scope?.closest('dialog[open],[role="dialog"],[role="alertdialog"]');
  return !!top && top !== owner;
}
