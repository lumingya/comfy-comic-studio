import { useLayoutEffect, useSyncExternalStore } from 'react';

let covers = 0;
const listeners = new Set<() => void>();

/** Register an immersive surface while it covers the workspace. Multiple overlays can coexist. */
export function useWallpaperOcclusion(active = true): void {
  useLayoutEffect(() => {
    if (!active) return;
    covers += 1;
    listeners.forEach((notify) => notify());
    return () => {
      covers -= 1;
      listeners.forEach((notify) => notify());
    };
  }, [active]);
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useWallpaperOccluded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => covers > 0,
    () => false,
  );
}
