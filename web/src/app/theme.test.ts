import { describe, expect, it } from 'vitest';
import type { ThemeInfo } from '../api/open';
import { applyTheme, migrateChoice, resolveTheme, SYSTEM, toggled } from './theme';

const theme = (id: string, mode: 'dark' | 'light', bg: string): ThemeInfo => ({
  id,
  name: id,
  mode,
  author: '',
  source: 'builtin',
  tokens: { bg, accent: '#abcdef' },
});
const themes = [theme('ink', 'dark', '#101312'), theme('paper', 'light', '#f3f4ef')];

describe('theme', () => {
  it('migrates the old dark / light values', () => {
    expect(migrateChoice('dark')).toBe('ink');
    expect(migrateChoice('light')).toBe('paper');
    expect(migrateChoice(undefined)).toBe(SYSTEM);
    expect(migrateChoice('sakura')).toBe('sakura');
  });

  it('follows the system preference and falls back for unknown ids', () => {
    expect(resolveTheme(SYSTEM, themes, true).id).toBe('ink');
    expect(resolveTheme(SYSTEM, themes, false).id).toBe('paper');
    expect(resolveTheme('paper', themes, true).mode).toBe('light');
    expect(resolveTheme('gone', themes, false).id).toBe('paper');
    expect(resolveTheme(SYSTEM, [], true)).toEqual({ id: 'ink', mode: 'dark', theme: undefined });
  });

  it('writes tokens and removes the previous theme ones', () => {
    const root = document.createElement('div');
    applyTheme(root, 'light', themes[1]);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.getPropertyValue('--bg')).toBe('#f3f4ef');
    applyTheme(root, 'dark', { ...themes[0], tokens: { bg: '#000000' } });
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
  });

  it('toggles between ink and paper by default', () => {
    expect(toggled('dark')).toBe('paper');
    expect(toggled('light')).toBe('ink');
  });

  it('toggles back to the last theme used in the other mode', () => {
    const recent = { dark: 'ext-midnight', light: 'ext-cream' };
    expect(toggled('dark', recent)).toBe('ext-cream');
    expect(toggled('light', recent)).toBe('ext-midnight');
    expect(toggled('light', { light: 'ext-cream' })).toBe('ink');
  });
});
