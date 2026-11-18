import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeInfo } from '../api/open';

function BackgroundVideo({ url, paused }: { url: string; paused: boolean }) {
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
    const syncPlayback = () => {
      if (paused || document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    syncPlayback();
    document.addEventListener('visibilitychange', syncPlayback);
    return () => document.removeEventListener('visibilitychange', syncPlayback);
  }, [url, paused]);

  return <video ref={ref} muted loop playsInline preload={paused ? 'metadata' : 'auto'} />;
}

export function ThemeBackdrop({
  background,
  opacity,
  paused,
}: {
  background: ThemeInfo['background'];
  opacity: number;
  paused: boolean;
}) {
  if (!background?.url || opacity <= 0 || typeof document === 'undefined') return null;
  return createPortal(
    <div className="theme-backdrop" style={{ opacity }} aria-hidden="true">
      {background.kind === 'video' ? (
        <BackgroundVideo url={background.url} paused={paused} />
      ) : background.animated && paused ? null : (
        <img src={background.url} alt="" />
      )}
    </div>,
    document.body,
  );
}
