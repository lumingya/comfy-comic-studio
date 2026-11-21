import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ThemeInfo } from '../api/open';
import { useWallpaperOccluded } from './wallpaperOcclusion';
import './themeBackdrop.css';

function BackgroundVideo({
  url,
  paused,
  suspended,
  playbackRate,
  loop,
}: {
  url: string;
  paused: boolean;
  suspended: boolean;
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
      else if (video.paused && (!video.ended || loop)) void video.play().catch(() => undefined);
    };
    // Metadata preload alone may not request the first decoded frame. Seek once when
    // mounting in static mode so there is a poster without starting playback.
    const primeStaticFrame = () => {
      if (paused && !suspended && !video.currentTime && video.readyState < 2 && video.duration > 0)
        video.currentTime = Math.min(video.duration / 2, 0.001);
    };
    const restartPlayback = () => {
      if (!loop || paused || document.hidden) return;
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    };
    syncPlayback();
    if (video.readyState >= 1) primeStaticFrame();
    video.addEventListener('canplay', syncPlayback);
    video.addEventListener('loadedmetadata', primeStaticFrame);
    video.addEventListener('ended', restartPlayback);
    return () => {
      video.removeEventListener('canplay', syncPlayback);
      video.removeEventListener('loadedmetadata', primeStaticFrame);
      video.removeEventListener('ended', restartPlayback);
    };
  }, [url, paused, suspended, loop]);

  return (
    <video
      ref={ref}
      autoPlay={!paused}
      muted
      loop={loop}
      playsInline
      preload={paused || suspended ? 'metadata' : 'auto'}
    />
  );
}

function drawPoster(canvas: HTMLCanvasElement | null, image: HTMLImageElement): boolean {
  if (!canvas || !image.naturalWidth || !image.naturalHeight) return false;
  // Keep the frozen copy bounded independently of the uploaded image size.
  const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return false;
  // Canvas draws the default frame of an animated image. It has no playback to suspend.
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return true;
}

function AnimatedBackground({
  url,
  paused,
  suspended,
}: {
  url: string;
  paused: boolean;
  suspended: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [posterReady, setPosterReady] = useState(false);

  // On a cold start in static mode, load a frame without mounting an animating image in the DOM.
  useEffect(() => {
    if (!paused || suspended || posterReady) return;
    const image = new Image();
    image.onload = () => setPosterReady(drawPoster(canvas.current, image));
    image.src = url;
    return () => {
      image.onload = null;
      image.removeAttribute('src');
    };
  }, [url, paused, suspended, posterReady]);

  return (
    <>
      <canvas ref={canvas} hidden={!paused || !posterReady} />
      {!paused ? (
        <img
          src={url}
          alt=""
          decoding="async"
          onLoad={(event) => {
            if (!posterReady) setPosterReady(drawPoster(canvas.current, event.currentTarget));
          }}
        />
      ) : null}
    </>
  );
}

function isFullscreenOverlay(): boolean {
  return Boolean(
    document.fullscreenElement && document.fullscreenElement !== document.documentElement,
  );
}

function useWallpaperIdle(timeoutSeconds: number, active: boolean): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (timeoutSeconds <= 0 || !active) {
      setIdle(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const resetTimer = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), timeoutSeconds * 1000);
    };
    const activityEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
    resetTimer();
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, resetTimer, { passive: true }),
    );
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [active, timeoutSeconds]);

  return timeoutSeconds > 0 && active && idle;
}

function useWallpaperSuspended(pauseWhenUnfocused: boolean): boolean {
  const covered = useWallpaperOccluded();
  const [hidden, setHidden] = useState(() => document.hidden);
  const [focused, setFocused] = useState(() => !pauseWhenUnfocused || document.hasFocus());
  const [fullscreenOverlay, setFullscreenOverlay] = useState(isFullscreenOverlay);

  useEffect(() => {
    const visibilityChanged = () => setHidden(document.hidden);
    const fullscreenChanged = () => setFullscreenOverlay(isFullscreenOverlay());
    visibilityChanged();
    fullscreenChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
    };
  }, []);

  useEffect(() => {
    if (!pauseWhenUnfocused) return;
    const blur = () => setFocused(false);
    const focus = () => setFocused(true);
    setFocused(document.hasFocus());
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, [pauseWhenUnfocused]);

  return covered || fullscreenOverlay || hidden || (pauseWhenUnfocused && !focused);
}

function DynamicBackground({
  kind,
  url,
  paused,
  pauseWhenUnfocused,
  idleTimeoutSeconds,
  playbackRate,
  loop,
}: {
  kind: 'video' | 'image';
  url: string;
  paused: boolean;
  pauseWhenUnfocused: boolean;
  idleTimeoutSeconds: number;
  playbackRate: number;
  loop: boolean;
}) {
  const suspended = useWallpaperSuspended(pauseWhenUnfocused);
  const idle = useWallpaperIdle(idleTimeoutSeconds, !paused && !suspended);
  const stopped = paused || suspended || idle;
  return kind === 'video' ? (
    <BackgroundVideo
      url={url}
      paused={stopped}
      suspended={suspended}
      playbackRate={playbackRate}
      loop={loop}
    />
  ) : (
    <AnimatedBackground key={url} url={url} paused={stopped} suspended={suspended} />
  );
}

export function ThemeBackdrop({
  background,
  opacity,
  paused,
  pauseWhenUnfocused = true,
  idleTimeoutSeconds = 30,
  playbackRate = 1,
  loop = true,
}: {
  background: ThemeInfo['background'];
  opacity: number;
  paused: boolean;
  pauseWhenUnfocused?: boolean;
  idleTimeoutSeconds?: number;
  playbackRate?: number;
  loop?: boolean;
}) {
  if (!background?.url || opacity <= 0 || typeof document === 'undefined') return null;
  return createPortal(
    <div className="theme-backdrop" style={{ opacity }} aria-hidden="true">
      {background.kind === 'video' || background.animated ? (
        <DynamicBackground
          kind={background.kind}
          url={background.url}
          paused={paused}
          pauseWhenUnfocused={pauseWhenUnfocused}
          idleTimeoutSeconds={idleTimeoutSeconds}
          playbackRate={playbackRate}
          loop={loop}
        />
      ) : (
        <img src={background.url} alt="" decoding="async" />
      )}
    </div>,
    document.body,
  );
}
