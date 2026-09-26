import { useEffect } from 'react';

const APP = 'Mio';

/** Browser tab title for the current screen: `第一话 · 雨夜 — Mio`. Empty parts are skipped. */
export function usePageTitle(...parts: (string | null | undefined | false)[]): void {
  const text = parts.filter(Boolean).join(' · ');
  useEffect(() => {
    document.title = text ? `${text} — ${APP}` : APP;
  }, [text]);
}
