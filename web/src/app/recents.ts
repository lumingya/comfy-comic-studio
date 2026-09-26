import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** An episode the user opened, remembered for the rail's "Recent" list. */
export interface RecentEpisode {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  /** Unix milliseconds of the last visit. */
  at: number;
}

export const MAX_RECENTS = 6;

/** Newest first, no duplicates, capped at `max`. Pure so it can be unit-tested. */
export function pushRecent(
  list: RecentEpisode[],
  item: RecentEpisode,
  max = MAX_RECENTS,
): RecentEpisode[] {
  return [item, ...list.filter((r) => r.id !== item.id)].slice(0, max);
}

interface RecentsState {
  items: RecentEpisode[];
  /** Record a visit (or refresh the title of an already remembered episode). */
  visit: (item: Omit<RecentEpisode, 'at'>) => void;
  /** Forget an episode (deleted, or dismissed from the rail). */
  forget: (id: string) => void;
}

export const useRecents = create<RecentsState>()(
  persist(
    (set, get) => ({
      items: [],
      visit: (item) => set({ items: pushRecent(get().items, { ...item, at: Date.now() }) }),
      forget: (id) => set({ items: get().items.filter((r) => r.id !== id) }),
    }),
    { name: 'mio.recents', version: 1 },
  ),
);
