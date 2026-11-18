import { useEffect } from 'react';
import type { ThemeInfo } from '../api/open';

export function ThemeStylesheet({ theme }: { theme?: ThemeInfo }) {
  const styleUrl = theme?.style_url;
  const themeId = theme?.id;
  useEffect(() => {
    if (!styleUrl || !themeId) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;
    link.dataset.mioTheme = themeId;
    document.head.append(link);
    return () => link.remove();
  }, [styleUrl, themeId]);
  return null;
}
