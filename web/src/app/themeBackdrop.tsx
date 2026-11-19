import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeInfo } from '../api/open';

function BackgroundVideo({
  url,
  paused,
  playbackRate,
  loop,
}: {
  url: string;
  paused: boolean;
  playbackRate: number;
  loop: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.src = url;
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, url]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.loop = loop;
    const syncPlayback = () => {
      if (paused || document.hidden) video.pause();
      else if (video.paused) void video.play().catch(() => undefined);
    };
    const restartPlayback = () => {
      if (!loop || paused || document.hidden) return;
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    };
    syncPlayback();
    video.addEventListener('canplay', syncPlayback);
    video.addEventListener('ended', restartPlayback);
    document.addEventListener('visibilitychange', syncPlayback);
    return () => {
      video.removeEventListener('canplay', syncPlayback);
      video.removeEventListener('ended', restartPlayback);
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [url, paused, loop]);

  return (
    <video
      ref={ref}
      autoPlay={!paused}
      muted
      loop={loop}
      playsInline
      preload={paused ? 'metadata' : 'auto'}
    />
  );
}

export function ThemeBackdrop({
  background,
  opacity,
  paused,
  playbackRate = 1,
  loop = true,
}: {
  background: ThemeInfo['background'];
  opacity: number;
  paused: boolean;
  playbackRate?: number;
  loop?: boolean;
}) {
  if (!background?.url || opacity <= 0 || typeof document === 'undefined') return null;
  return createPortal(
    <div className="theme-backdrop" style={{ opacity }} aria-hidden="true">
      {background.kind === 'video' ? (
        <BackgroundVideo
          url={background.url}
          paused={paused}
          playbackRate={playbackRate}
          loop={loop}
        />
      ) : background.animated && paused ? null : (
        <img src={background.url} alt="" />
      )}
    </div>,
    document.body,
  );
}
