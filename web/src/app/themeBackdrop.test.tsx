import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest runs in Node; the browser app intentionally omits Node type declarations.
import { readFileSync } from 'node:fs';
import { ThemeBackdrop } from './themeBackdrop';
import { useWallpaperOcclusion } from './wallpaperOcclusion';

function styleBlock(stylesheet: string, selector: string): string {
  const start = stylesheet.indexOf(selector);
  expect(start, `expected a CSS rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = stylesheet.indexOf('{', start);
  const close = stylesheet.indexOf('}', open);
  return stylesheet.slice(open, close);
}

const classicStyles = readFileSync('src/styles/classic.css', 'utf8');
const pagesStyles = readFileSync('src/styles/pages.css', 'utf8');
const studioStyles = readFileSync('src/styles/studio.css', 'utf8');

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('theme image motion', () => {
  it('keeps high-frequency chip, status, and reader surfaces free of backdrop blur', () => {
    const highFrequencyRules = [
      styleBlock(classicStyles, '.glass-chip,'),
      styleBlock(pagesStyles, '.work-status'),
      styleBlock(studioStyles, '.reader-tools'),
    ];

    for (const rule of highFrequencyRules) {
      expect(rule).not.toMatch(/backdrop-filter\s*:/i);
    }
  });

  it('pauses animated images while preserving static image backgrounds', () => {
    const { rerender } = render(
      <ThemeBackdrop
        background={{
          kind: 'image',
          url: '/animated.gif',
          opacity: 0.4,
          animated: true,
          mime_type: 'image/gif',
        }}
        opacity={0.4}
        paused
      />,
    );
    expect(document.body.querySelector('.theme-backdrop img')).toBeNull();

    rerender(
      <ThemeBackdrop
        background={{
          kind: 'image',
          url: '/static.png',
          opacity: 0.4,
          animated: false,
          mime_type: 'image/png',
        }}
        opacity={0.4}
        paused
      />,
    );
    expect(document.body.querySelector('.theme-backdrop img')).toHaveAttribute(
      'src',
      '/static.png',
    );
  });

  it('autoplays muted video, loops it, and restarts if playback ends', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const { unmount } = render(
      <ThemeBackdrop
        background={{
          kind: 'video',
          url: '/wallpaper.mp4',
          opacity: 0.4,
          animated: false,
          mime_type: 'video/mp4',
        }}
        opacity={0.4}
        paused={false}
      />,
    );
    const video = document.body.querySelector<HTMLVideoElement>('.theme-backdrop video')!;
    expect(video).toHaveProperty('muted', true);
    expect(video).toHaveProperty('loop', true);
    expect(video).toHaveProperty('autoplay', true);
    expect(video).toHaveAttribute('playsinline');
    expect(play).toHaveBeenCalled();

    const initialCalls = play.mock.calls.length;
    video.dispatchEvent(new Event('ended'));
    expect(play.mock.calls.length).toBeGreaterThan(initialCalls);
    unmount();
    expect(video).not.toHaveAttribute('src');
    expect(video.paused).toBe(true);
    play.mockRestore();
  });

  it('retries muted autoplay when media becomes playable', () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new Error('media is not ready'))
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const { unmount } = render(
      <ThemeBackdrop
        background={{
          kind: 'video',
          url: '/wallpaper.mp4',
          opacity: 0.4,
          animated: false,
          mime_type: 'video/mp4',
        }}
        opacity={0.4}
        paused={false}
      />,
    );
    const video = document.body.querySelector('.theme-backdrop video')!;
    expect(play).toHaveBeenCalledTimes(1);
    video.dispatchEvent(new Event('canplay'));
    expect(play).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('does not request playback while the background is paused', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const { unmount } = render(
      <ThemeBackdrop
        background={{
          kind: 'video',
          url: '/wallpaper.mp4',
          opacity: 0.4,
          animated: false,
          mime_type: 'video/mp4',
        }}
        opacity={0.4}
        paused
      />,
    );
    expect(play).not.toHaveBeenCalled();
    unmount();
    play.mockRestore();
  });

  it('updates playback rate and loop mode when preferences change', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const view = render(
      <ThemeBackdrop
        background={{
          kind: 'video',
          url: '/local-wallpaper.mp4',
          opacity: 0.4,
          animated: false,
          mime_type: 'video/mp4',
        }}
        opacity={0.4}
        paused={false}
        playbackRate={0.5}
        loop
      />,
    );
    const video = document.body.querySelector<HTMLVideoElement>('.theme-backdrop video')!;
    expect(video.playbackRate).toBe(0.5);
    view.rerender(
      <ThemeBackdrop
        background={{
          kind: 'video',
          url: '/local-wallpaper.mp4',
          opacity: 0.4,
          animated: false,
          mime_type: 'video/mp4',
        }}
        opacity={0.4}
        paused={false}
        playbackRate={2}
        loop={false}
      />,
    );
    expect(video.playbackRate).toBe(2);
    expect(video.loop).toBe(false);
    const playCalls = play.mock.calls.length;
    video.dispatchEvent(new Event('ended'));
    expect(play).toHaveBeenCalledTimes(playCalls);
    view.unmount();
    play.mockRestore();
  });

  it('pauses an animated wallpaper after the configured idle timeout and resumes on activity', () => {
    vi.useFakeTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const wallpaper = {
      kind: 'video',
      url: '/wallpaper.mp4',
      opacity: 0.4,
      animated: false,
      mime_type: 'video/mp4',
    } as const;
    const view = render(
      <ThemeBackdrop background={wallpaper} opacity={0.4} paused={false} idleTimeoutSeconds={30} />,
    );
    const video = document.querySelector<HTMLVideoElement>('.theme-backdrop video')!;
    expect(video.autoplay).toBe(true);
    act(() => vi.advanceTimersByTime(29_999));
    expect(video.autoplay).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(video.autoplay).toBe(false);
    expect(pause).toHaveBeenCalled();

    const playCalls = play.mock.calls.length;
    fireEvent.pointerMove(window);
    expect(video.autoplay).toBe(true);
    expect(play.mock.calls.length).toBeGreaterThan(playCalls);
    act(() => vi.advanceTimersByTime(30_000));
    expect(video.autoplay).toBe(false);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(video.autoplay).toBe(true);
    view.unmount();
    vi.useRealTimers();
  });

  it('keeps the paused video frame through focus, visibility and nested full-screen changes', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const wallpaper = {
      kind: 'video',
      url: '/wallpaper.mp4',
      opacity: 0.4,
      animated: false,
      mime_type: 'video/mp4',
    } as const;
    function Cover({ open }: { open: boolean }) {
      useWallpaperOcclusion(open);
      return null;
    }
    const renderTree = (first = false, second = false, pauseWhenUnfocused = true) => (
      <>
        <ThemeBackdrop
          background={wallpaper}
          opacity={0.4}
          paused={false}
          pauseWhenUnfocused={pauseWhenUnfocused}
        />
        <Cover open={first} />
        <Cover open={second} />
      </>
    );
    const view = render(renderTree());
    const video = document.querySelector<HTMLVideoElement>('.theme-backdrop video')!;
    video.currentTime = 3;
    expect(play).toHaveBeenCalled();
    fireEvent.blur(window);
    expect(video.autoplay).toBe(false);
    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(3);

    view.rerender(renderTree(true, true));
    fireEvent.focus(window);
    view.rerender(renderTree(false, true));
    expect(video.autoplay).toBe(false);
    act(() => hidden.mockReturnValue(true));
    fireEvent(document, new Event('visibilitychange'));
    view.rerender(renderTree());
    expect(video.autoplay).toBe(false);
    act(() => hidden.mockReturnValue(false));
    fireEvent(document, new Event('visibilitychange'));
    expect(video.autoplay).toBe(true);
    expect(document.querySelector('.theme-backdrop video')).toBe(video);

    view.rerender(renderTree(false, false, false));
    fireEvent.blur(window);
    expect(video.autoplay).toBe(true);
    view.unmount();
  });

  it('retains an animated image poster after it removes the moving image', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    render(
      <ThemeBackdrop
        background={{
          kind: 'image',
          url: '/animated.gif',
          opacity: 0.4,
          animated: true,
          mime_type: 'image/gif',
        }}
        opacity={0.4}
        paused={false}
      />,
    );
    const image = document.querySelector('.theme-backdrop img')!;
    Object.defineProperties(image, {
      naturalWidth: { value: 4000 },
      naturalHeight: { value: 2000 },
    });
    fireEvent.load(image);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1920, 960);
    fireEvent.blur(window);
    expect(image).not.toBeInTheDocument();
    expect(document.querySelector('.theme-backdrop canvas')).toBeVisible();
    fireEvent.focus(window);
    expect(document.querySelector('.theme-backdrop img')).toBeInTheDocument();
    expect(document.querySelector('.theme-backdrop canvas')).not.toBeVisible();
  });
});
