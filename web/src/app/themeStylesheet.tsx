import { useEffect } from 'react';
import type { ThemeInfo } from '../api/open';
import { themeDiagnosticSession } from './themeDiagnostics';

export function ThemeStylesheet({ theme }: { theme?: ThemeInfo }) {
  const styleUrl = theme?.style_url;
  const themeId = theme?.id;
  useEffect(() => {
    if (!styleUrl || !themeId) return;
    const report = themeDiagnosticSession('stylesheet', themeId);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;
    link.dataset.mioTheme = themeId;
    const onLoad = () => report('style-loaded');
    const onError = () => report('style-load-error');
    link.addEventListener('load', onLoad, { once: true });
    link.addEventListener('error', onError, { once: true });
    report('style-loading');
    document.head.append(link);
    return () => {
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
      link.remove();
      report('style-cleaned');
    };
  }, [styleUrl, themeId]);
  return null;
}
