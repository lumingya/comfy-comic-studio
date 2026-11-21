import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useThemePreferences, useThemeWallpapers, useThemes } from '../api/open';
import {
  applyTheme,
  effectiveThemeBackground,
  resolveTheme,
  shouldPauseThemeVideo,
  systemPrefersDark,
  toggled,
} from './theme';
import { useUI } from './ui-store';
import { ThemeBackdrop } from './themeBackdrop';
import { themeScriptKey, useThemeScript } from './themeScript';
import { ThemeStylesheet } from './themeStylesheet';

const ThemeMode = createContext<'dark' | 'light' | null>(null);

/** The shell owns theme resolution, the system subscription and writes to <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const themeOpacity = useUI((s) => s.themeOpacity);
  const paused = useUI((s) => s.themeBackgroundPaused);
  const pauseWhenUnfocused = useUI((s) => s.pauseWallpaperWhenUnfocused);
  const allowThemeVideoWithReducedMotion = useUI((s) => s.allowThemeVideoWithReducedMotion);
  const enabledThemeScripts = useUI((s) => s.enabledThemeScripts);
  const reduceMotion = useUI((s) => s.reduceMotion);
  const themes = useThemes();
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const resolved = resolveTheme(choice, themes.data ?? [], prefersDark);
  const activeThemeId = resolved.theme?.id ?? null;
  const preferences = useThemePreferences(activeThemeId);
  const wallpapers = useThemeWallpapers(activeThemeId);
  const background = effectiveThemeBackground(
    resolved.theme,
    preferences.data,
    wallpapers.data?.items,
  );
  const playbackRate =
    typeof preferences.data?.playbackRate === 'number'
      ? Math.max(0.25, Math.min(4, preferences.data.playbackRate))
      : 1;
  const loop = preferences.data?.loop !== false;
  const opacity = background ? (themeOpacity[resolved.id] ?? background.opacity) : 0;
  const backgroundEnabled = opacity > 0;
  const dynamicBackground =
    backgroundEnabled && (background?.kind === 'video' || !!background?.animated);
  useEffect(() => {
    applyTheme(
      document.documentElement,
      resolved.mode,
      resolved.theme,
      backgroundEnabled,
      dynamicBackground,
    );
  }, [resolved.mode, resolved.theme, backgroundEnabled, dynamicBackground]);
  useEffect(() => {
    const resetTheme = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        !['Digit0', 'Numpad0'].includes(event.code)
      )
        return;
      event.preventDefault();
      setTheme('system');
    };
    window.addEventListener('keydown', resetTheme);
    return () => window.removeEventListener('keydown', resetTheme);
  }, [setTheme]);
  useThemeScript(
    resolved.theme,
    !reduceMotion &&
      !reducedMotion &&
      enabledThemeScripts.includes(themeScriptKey(resolved.theme) ?? ''),
  );
  return (
    <ThemeMode.Provider value={resolved.mode}>
      <ThemeStylesheet theme={resolved.theme} />
      <ThemeBackdrop
        background={background}
        opacity={opacity}
        paused={shouldPauseThemeVideo(
          paused,
          reduceMotion,
          reducedMotion,
          background?.kind === 'video' && allowThemeVideoWithReducedMotion,
        )}
        pauseWhenUnfocused={pauseWhenUnfocused}
        playbackRate={playbackRate}
        loop={loop}
      />
      {children}
    </ThemeMode.Provider>
  );
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
