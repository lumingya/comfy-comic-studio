import { describe, expect, it } from 'vitest';
import type { ThemeInfo } from '../api/open';
import {
  applyTheme,
  effectiveThemeBackground,
  migrateChoice,
  resolveTheme,
  shouldPauseThemeVideo,
  SYSTEM,
  toggled,
} from './theme';

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

  it('only overrides the system motion preference when explicitly enabled', () => {
    expect(shouldPauseThemeVideo(false, false, true, false)).toBe(true);
    expect(shouldPauseThemeVideo(false, false, true, true)).toBe(false);
    expect(shouldPauseThemeVideo(false, true, true, true)).toBe(true);
    expect(shouldPauseThemeVideo(true, false, false, true)).toBe(true);
    expect(shouldPauseThemeVideo(false, false, false, false)).toBe(false);
  });

  it('writes tokens and removes the previous theme ones', () => {
    const root = document.createElement('div');
    applyTheme(root, 'light', themes[1]);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.getPropertyValue('--bg')).toBe('#f3f4ef');
    applyTheme(root, 'dark', { ...themes[0], tokens: { bg: '#000000' } });
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.getPropertyValue('--bg')).toBe('#000000');
    expect(root.dataset.themeBackground).toBe('false');
    applyTheme(root, 'dark', {
      ...themes[0],
      background: {
        kind: 'video',
        url: '/video.mp4',
        opacity: 0.4,
        animated: false,
        mime_type: 'video/mp4',
      },
    });
    expect(root.dataset.themeBackground).toBe('true');
    applyTheme(root, 'dark', themes[0], false);
    expect(root.dataset.themeBackground).toBe('false');
  });

  it('makes core surfaces translucent only with a theme background', () => {
    const root = document.createElement('div');
    const selected = {
      ...themes[0],
      tokens: {
        ...themes[0].tokens,
        'bg-deep': '#121416',
        panel: '#222222',
        'panel-2': '#2a2a2a',
        hover: '#333333',
      },
    };
    applyTheme(root, 'dark', selected, true);
    expect(root.style.getPropertyValue('--panel')).toContain('color-mix');
    expect(root.style.getPropertyValue('--bg')).toContain('color-mix');
    expect(root.style.getPropertyValue('--panel-2')).toContain('color-mix');
    expect(root.style.getPropertyValue('--bg-deep')).toContain('color-mix');
    expect(root.style.getPropertyValue('--hover')).toContain('color-mix');
    expect(root.style.getPropertyValue('--side')).toContain('color-mix');
    applyTheme(root, 'dark', selected);
    expect(root.style.getPropertyValue('--panel')).toBe('#222222');
    expect(root.style.getPropertyValue('--side')).toBe('');
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

  it('preserves a complete media descriptor, with a package fallback for missing private media', () => {
    const background = {
      kind: 'image' as const,
      url: '/package.png',
      opacity: 0.6,
      animated: false,
      mime_type: 'image/png',
    };
    const selected = { ...themes[0], background };
    const wallpaper = {
      id: 'private',
      filename: 'private.webp',
      kind: 'image' as const,
      url: '/private.webp',
      animated: true,
      mime_type: 'image/webp',
    };
    expect(effectiveThemeBackground(selected, { wallpaper_id: 'missing' }, [wallpaper])).toBe(
      background,
    );
    expect(effectiveThemeBackground(selected, { wallpaper_id: wallpaper.id }, [wallpaper])).toEqual(
      {
        ...wallpaper,
        opacity: 0.6,
      },
    );
    expect(
      effectiveThemeBackground(themes[0], { wallpaper_id: wallpaper.id }, [wallpaper]),
    ).toEqual({
      ...wallpaper,
      opacity: 0.35,
    });
  });
});
