import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateChoice, SYSTEM, type ThemeChoice } from './theme';

interface UIState {
  /** 'system' or a theme id (see app/theme.ts). */
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
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
    (set) => ({
      theme: SYSTEM,
      setTheme: (theme) => set({ theme }),
      variantId: null,
      setVariant: (variantId) => set({ variantId }),
      showRejected: false,
      setShowRejected: (showRejected) => set({ showRejected }),
      candidates: 2,
      setCandidates: (candidates) => set({ candidates }),
    }),
    {
      name: 'mio.ui',
      version: 1,
      partialize: (s) => ({ theme: s.theme, candidates: s.candidates }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<UIState>;
        return { ...state, theme: migrateChoice(state.theme) } as UIState;
      },
    },
  ),
);
