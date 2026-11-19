import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeBackdrop } from './themeBackdrop';

afterEach(() => vi.restoreAllMocks());

describe('theme image motion', () => {
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
});
