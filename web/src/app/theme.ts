import type { ThemeInfo } from '../api/open';

/** 'system' follows the OS; anything else is a theme id from /api/themes. */
export type ThemeChoice = string;

export const SYSTEM = 'system';
const FALLBACK = { dark: 'ink', light: 'paper' } as const;

/** Old builds stored 'dark' / 'light'; map them onto the built-in ink / paper themes. */
export function migrateChoice(value: unknown): ThemeChoice {
  if (value === 'dark') return 'ink';
  if (value === 'light') return 'paper';
  return typeof value === 'string' && value ? value : SYSTEM;
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Pick the theme to show; unknown ids (a removed extension) fall back like 'system'. */
export function resolveTheme(
  choice: ThemeChoice,
  themes: ThemeInfo[],
  prefersDark: boolean,
): { id: string; mode: 'dark' | 'light'; theme?: ThemeInfo } {
  const direct = choice !== SYSTEM ? themes.find((t) => t.id === choice) : undefined;
  if (direct) return { id: direct.id, mode: direct.mode, theme: direct };
  const mode = prefersDark ? 'dark' : 'light';
  const id = FALLBACK[mode];
  return { id, mode, theme: themes.find((t) => t.id === id) };
}

export function shouldPauseThemeVideo(
  manuallyPaused: boolean,
  reduceMotion: boolean,
  systemPrefersReducedMotion: boolean,
  allowSystemOverride: boolean,
): boolean {
  return manuallyPaused || reduceMotion || (systemPrefersReducedMotion && !allowSystemOverride);
}

const applied = new Set<string>();
const SURFACE_OPACITY: Record<string, number> = {
  bg: 0.56,
  'bg-deep': 0.62,
  panel: 0.68,
  'panel-2': 0.72,
  hover: 0.78,
};

/** Write the resolved theme onto <html>: data-theme for the CSS fallbacks + token variables. */
export function applyTheme(
  root: HTMLElement,
  mode: 'dark' | 'light',
  theme?: ThemeInfo,
  backgroundEnabled = Boolean(theme?.background?.url),
): void {
  root.dataset.theme = mode;
  root.dataset.themeBackground = backgroundEnabled ? 'true' : 'false';
  root.style.colorScheme = mode;
  for (const name of applied) root.style.removeProperty(`--${name}`);
  applied.clear();
  for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
    const opacity = backgroundEnabled ? SURFACE_OPACITY[name] : undefined;
    root.style.setProperty(
      `--${name}`,
      opacity === undefined ? value : `color-mix(in srgb, ${value} ${opacity * 100}%, transparent)`,
    );
    applied.add(name);
  }
  if (backgroundEnabled) {
    const side = mode === 'dark' ? '#17191b' : '#ecefe7';
    root.style.setProperty('--side', `color-mix(in srgb, ${side} 68%, transparent)`);
    applied.add('side');
  }
}

/**
 * Next theme for the quick toggle in the rail: the other mode's last-used theme, so someone on
 * an extension's dark theme comes back to it after a trip through light (ink / paper otherwise).
 */
export function toggled(
  currentMode: 'dark' | 'light',
  recent: Partial<Record<'dark' | 'light', string>> = {},
): ThemeChoice {
  const target = currentMode === 'dark' ? 'light' : 'dark';
  return recent[target] || FALLBACK[target];
}
