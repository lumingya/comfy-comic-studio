import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useThemes } from '../api/open';
import { applyTheme, resolveTheme, systemPrefersDark, toggled } from './theme';
import { useUI } from './ui-store';

const ThemeMode = createContext<'dark' | 'light' | null>(null);

/** The shell owns theme resolution, the system subscription and writes to <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useUI((s) => s.theme);
  const themes = useThemes();
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const resolved = resolveTheme(choice, themes.data ?? [], prefersDark);
  useEffect(() => {
    applyTheme(document.documentElement, resolved.mode, resolved.theme);
  }, [resolved.mode, resolved.theme]);
  return <ThemeMode.Provider value={resolved.mode}>{children}</ThemeMode.Provider>;
}

/** Flip between the last dark and light themes (top bar button, command palette). */
export function useThemeToggle() {
  const mode = useContext(ThemeMode);
  const setTheme = useUI((s) => s.setTheme);
  const recentThemes = useUI((s) => s.recentThemes);
  if (mode === null) throw new Error('useThemeToggle requires ThemeProvider');
  return {
    mode,
    toggle: () => setTheme(toggled(mode, recentThemes), mode === 'dark' ? 'light' : 'dark'),
  };
}
