import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUI } from './ui-store';
import { ThemeProvider, useThemeToggle } from './useTheme';
import type { MediaDescriptor } from '../api/open';

const { wallpaperState } = vi.hoisted(() => ({
  wallpaperState: {
    selected: false,
    animated: true,
    kind: 'image' as 'image' | 'video',
    mime_type: 'image/gif',
    packageBackground: null as (MediaDescriptor & { opacity: number }) | null,
  },
}));

vi.mock('../api/open', () => ({
  useThemes: () => ({
    data: [
      {
        id: 'ink',
        mode: 'dark',
        tokens: { bg: '#131517' },
        background: wallpaperState.packageBackground,
      },
      { id: 'paper', mode: 'light', tokens: { bg: '#f3f5f0' } },
      { id: 'custom', mode: 'dark', tokens: { 'radius-control': '12px' } },
    ],
  }),
  useThemePreferences: () => ({
    data: wallpaperState.selected ? { wallpaper_id: 'wallpaper_1' } : {},
  }),
  useThemeWallpapers: () => ({
    data: {
      items: wallpaperState.selected
        ? [
            {
              id: 'wallpaper_1',
              filename: 'wallpaper.gif',
              kind: wallpaperState.kind,
              url: '/api/themes/ink/wallpapers/wallpaper_1/file',
              animated: wallpaperState.animated,
              mime_type: wallpaperState.mime_type,
            },
          ]
        : [],
    },
  }),
}));

function Toggle({ name }: { name: string }) {
  const theme = useThemeToggle();
  return (
    <button onClick={theme.toggle}>
      {name}: {theme.mode}
    </button>
  );
}

describe('theme ownership', () => {
  const listeners = new Map<string, Set<() => void>>();
  let dark = true;
  let reducedMotion = false;

  beforeEach(() => {
    dark = true;
    reducedMotion = false;
    wallpaperState.selected = false;
    wallpaperState.animated = true;
    wallpaperState.kind = 'image';
    wallpaperState.mime_type = 'image/gif';
    wallpaperState.packageBackground = null;
    listeners.clear();
    useUI.setState({
      theme: 'system',
      recentThemes: {},
      reduceMotion: false,
      themeBackgroundPaused: false,
      pauseWallpaperWhenUnfocused: true,
      allowThemeVideoWithReducedMotion: false,
      themeOpacity: {},
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)'
          ? dark
          : query === '(prefers-reduced-motion: reduce)' && reducedMotion;
      },
      addEventListener: (_: string, listener: () => void) => {
        const group = listeners.get(query) ?? new Set<() => void>();
        group.add(listener);
        listeners.set(query, group);
      },
      removeEventListener: (_: string, listener: () => void) =>
        listeners.get(query)?.delete(listener),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shares system changes and one subscription across all toggle entry points', () => {
    const view = render(
      <ThemeProvider>
        <Toggle name="toolbar" />
        <Toggle name="palette" />
      </ThemeProvider>,
    );
    expect(listeners.get('(prefers-color-scheme: dark)')?.size).toBe(1);
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => {
      dark = false;
      listeners.get('(prefers-color-scheme: dark)')?.forEach((listener) => listener());
    });
    expect(screen.getByRole('button', { name: 'toolbar: light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'palette: light' })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'palette: light' }));
    expect(useUI.getState().theme).toBe('ink');
    expect(screen.getByRole('button', { name: 'toolbar: dark' })).toBeInTheDocument();
    view.unmount();
    expect([...listeners.values()].flatMap((group) => [...group])).toHaveLength(0);
  });

  it('clears custom control overrides when switching to an ordinary theme', () => {
    useUI.setState({ theme: 'custom' });
    render(
      <ThemeProvider>
        <Toggle name="toolbar" />
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--radius-control')).toBe('12px');
    fireEvent.click(screen.getByRole('button', { name: 'toolbar: dark' }));
    expect(document.documentElement.style.getPropertyValue('--radius-control')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f3f5f0');
  });

  it('provides a keyboard recovery shortcut for a custom stylesheet that hides the UI', () => {
    useUI.setState({ theme: 'custom' });
    render(
      <ThemeProvider>
        <Toggle name="toolbar" />
      </ThemeProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Digit0', ctrlKey: true, shiftKey: true }),
      );
    });
    expect(useUI.getState().theme).toBe('system');
  });

  it.each(['application', 'system', 'manual'])(
    'pauses uploaded animated images for %s motion preferences, while keeping static images',
    (preference) => {
      wallpaperState.selected = true;
      useUI.setState({ theme: 'ink', allowThemeVideoWithReducedMotion: true });
      const view = render(<ThemeProvider>Workspace</ThemeProvider>);
      expect(document.querySelector('.theme-backdrop img')).toHaveAttribute(
        'src',
        '/api/themes/ink/wallpapers/wallpaper_1/file',
      );
      expect(document.documentElement).toHaveAttribute('data-theme-dynamic-background', 'true');
      act(() => {
        if (preference === 'application') useUI.setState({ reduceMotion: true });
        else if (preference === 'manual') useUI.setState({ themeBackgroundPaused: true });
        else {
          reducedMotion = true;
          listeners.get('(prefers-reduced-motion: reduce)')?.forEach((listener) => listener());
        }
      });
      expect(document.querySelector('.theme-backdrop img')).not.toBeInTheDocument();
      wallpaperState.animated = false;
      view.rerender(<ThemeProvider>Workspace</ThemeProvider>);
      expect(document.querySelector('.theme-backdrop img')).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute('data-theme-dynamic-background', 'false');
    },
  );

  const media = [
    { kind: 'image', mime_type: 'image/png', animated: false },
    { kind: 'image', mime_type: 'image/gif', animated: true },
    { kind: 'image', mime_type: 'image/png', animated: true },
    { kind: 'image', mime_type: 'image/webp', animated: true },
    { kind: 'video', mime_type: 'video/mp4', animated: false },
  ] as const;
  const motionCases = [false, true].flatMap((manual) =>
    [false, true].flatMap((application) =>
      [false, true].flatMap((system) =>
        [false, true].map((override) => ({ manual, application, system, override })),
      ),
    ),
  );
  const cases = ['package', 'private'].flatMap((source) =>
    media.flatMap((descriptor) =>
      motionCases.map((motion) => ({ source, ...descriptor, ...motion })),
    ),
  );

  it.each(cases)(
    'applies motion policy to $source $mime_type animated=$animated with manual=$manual Mio=$application system=$system override=$override',
    ({ source, kind, mime_type, animated, manual, application, system, override }) => {
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
      vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
      wallpaperState.selected = source === 'private';
      wallpaperState.kind = kind;
      wallpaperState.animated = animated;
      wallpaperState.mime_type = mime_type;
      wallpaperState.packageBackground = {
        kind,
        mime_type,
        animated,
        opacity: 0.4,
        url: '/package-media',
      };
      reducedMotion = system;
      useUI.setState({
        theme: 'ink',
        reduceMotion: application,
        themeBackgroundPaused: manual,
        allowThemeVideoWithReducedMotion: override,
      });
      const view = render(<ThemeProvider>Workspace</ThemeProvider>);
      const paused = manual || application || (system && !(kind === 'video' && override));
      const image = document.querySelector('.theme-backdrop img');
      if (kind === 'image') {
        if (animated && paused) expect(image).not.toBeInTheDocument();
        else
          expect(image).toHaveAttribute(
            'src',
            source === 'private' ? '/api/themes/ink/wallpapers/wallpaper_1/file' : '/package-media',
          );
        expect(document.querySelector('.theme-backdrop video')).not.toBeInTheDocument();
      } else {
        expect(document.querySelector('.theme-backdrop video')).toHaveProperty('autoplay', !paused);
        if (paused) expect(play).not.toHaveBeenCalled();
        else expect(play).toHaveBeenCalled();
      }
      view.unmount();
    },
  );
});
