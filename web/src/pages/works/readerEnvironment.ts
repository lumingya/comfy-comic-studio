import { useEffect, useState, type RefObject } from 'react';
import { DESKTOP_QUERY } from './readingStage';

/** Own the native dialog, fullscreen state and the current reading viewport. */
export function useReaderEnvironment(
  ref: RefObject<HTMLDialogElement | null>,
  scroller: HTMLDivElement | null,
) {
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);
  const [fullscreenHint, setFullscreenHint] = useState(false);
  useEffect(() => {
    const onChange = () => {
      setFullscreen(!!document.fullscreenElement);
      if (document.fullscreenElement) setFullscreenHint(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  /**
   * Legacy toggleReaderFullscreen: a modal <dialog> itself cannot go full screen, so the page does
   * and the dialog is re-shown to stay on top; without the Fullscreen API a hint explains F11.
   */
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.().catch(() => undefined);
      return;
    }
    try {
      const root = document.documentElement;
      if (!document.fullscreenEnabled || !root.requestFullscreen) throw new Error('unavailable');
      await root.requestFullscreen();
      const d = ref.current;
      if (d?.open && typeof d.showModal === 'function') {
        d.close();
        d.showModal();
      }
      setFullscreenHint(false);
    } catch {
      setFullscreenHint(true);
    }
  };
  const [view, setView] = useState({ w: 0, h: 0 });
  const [desktop, setDesktop] = useState(() =>
    typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  useEffect(() => {
    const root = scroller;
    if (!root) return;
    const measure = () =>
      setView((v) =>
        v.w === root.clientWidth && v.h === root.clientHeight
          ? v
          : { w: root.clientWidth, h: root.clientHeight },
      );
    measure();
    window.addEventListener('resize', measure);
    // The presentation drawer narrows the stage without a window resize.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(root);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [scroller]);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    const opener = document.activeElement;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    return () => {
      d.close?.();
      if (opener instanceof HTMLElement && opener !== document.body)
        requestAnimationFrame(() => {
          if (
            opener.isConnected &&
            document.activeElement === document.body &&
            !document.querySelector('dialog[open]')
          )
            opener.focus({ preventScroll: true });
        });
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  return { view, desktop, fullscreen, fullscreenHint, setFullscreenHint, toggleFullscreen };
}
