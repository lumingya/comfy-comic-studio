import { useEffect, useState } from 'react';
import { useThemes } from '../api/open';
import { applyTheme, resolveTheme, systemPrefersDark, toggled } from './theme';
import { useUI } from './ui-store';

/** Resolve the chosen theme (or the OS preference) and keep <html> in sync. */
export function useAppliedTheme() {
  const choice = useUI((s) => s.theme);
  const themes = useThemes();
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const resolved = resolveTheme(choice, themes.data ?? [], prefersDark);
  useEffect(() => {
    applyTheme(document.documentElement, resolved.mode, resolved.theme);
  }, [resolved.mode, resolved.theme]);
  return resolved;
}

/** Flip between the last dark and light themes (top bar button, command palette). */
export function useThemeToggle() {
  const theme = useAppliedTheme();
  const setTheme = useUI((s) => s.setTheme);
  const recentThemes = useUI((s) => s.recentThemes);
  return {
    mode: theme.mode,
    toggle: () =>
      setTheme(toggled(theme.mode, recentThemes), theme.mode === 'dark' ? 'light' : 'dark'),
  };
}
