import i18n from '../i18n';
/** Clipboard is unavailable on some LAN/HTTP origins. Never report success without copying. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* Fall back to the user's current copy gesture, not to a network service. */
  }
  const active = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;left:-9999px;top:0';
  const host =
    active instanceof Element
      ? active.closest('dialog[open],[role="dialog"],[role="alertdialog"]')
      : null;
  (host ?? document.body).append(field);
  field.focus({ preventScroll: true });
  field.select();
  let copied = false;
  try {
    copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  } finally {
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
  if (!copied) throw new Error(i18n.t('interaction.copyFailed'));
}
