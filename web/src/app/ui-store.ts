import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface UIState {
  theme: Theme;
  toggleTheme: () => void;
  /** Board: which variant is being viewed (null = base). */
  variantId: string | null;
  setVariant: (id: string | null) => void;
  showRejected: boolean;
  setShowRejected: (v: boolean) => void;
  candidates: number;
  setCandidates: (n: number) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      variantId: null,
      setVariant: (variantId) => set({ variantId }),
      showRejected: false,
      setShowRejected: (showRejected) => set({ showRejected }),
      candidates: 2,
      setCandidates: (candidates) => set({ candidates }),
    }),
    { name: 'mio.ui', partialize: (s) => ({ theme: s.theme, candidates: s.candidates }) },
  ),
);
