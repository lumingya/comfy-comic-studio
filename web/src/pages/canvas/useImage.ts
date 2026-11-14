import { useEffect, useState } from 'react';

/** Load an image element for konva; null until decoded. */
export function useImage(src: string | null) {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new window.Image();
    img.onload = () => setLoaded({ src, image: img });
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return loaded?.src === src ? loaded.image : null;
}
