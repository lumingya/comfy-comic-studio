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

const applied = new Set<string>();

/** Write the resolved theme onto <html>: data-theme for the CSS fallbacks + token variables. */
export function applyTheme(root: HTMLElement, mode: 'dark' | 'light', theme?: ThemeInfo): void {
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  for (const name of applied) root.style.removeProperty(`--${name}`);
  applied.clear();
  for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
    root.style.setProperty(`--${name}`, value);
    applied.add(name);
  }
}

/** Next theme for the quick toggle in the rail: flips between ink and paper. */
export function toggled(currentMode: 'dark' | 'light'): ThemeChoice {
  return currentMode === 'dark' ? FALLBACK.light : FALLBACK.dark;
}
