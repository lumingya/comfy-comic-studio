import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateChoice, SYSTEM, type ThemeChoice } from './theme';

interface UIState {
  /** 'system' or a theme id (see app/theme.ts). */
  theme: ThemeChoice;
  /** Last explicit theme id per mode, for the quick toggle (see theme.toggled). */
  recentThemes: Partial<Record<'dark' | 'light', string>>;
  setTheme: (theme: ThemeChoice, mode?: 'dark' | 'light') => void;
  /** Board: which variant is being viewed (null = base). */
  variantId: string | null;
  setVariant: (id: string | null) => void;
  showRejected: boolean;
  setShowRejected: (v: boolean) => void;
  candidates: number;
  setCandidates: (n: number) => void;
  /**
   * Studio (professional) mode.  Off by default: the classic prompt → generate → pick flow.
   * On: shot / angle, cast details, layout, composition, per-panel render overrides and the
   * rest of the webtoon toolkit appear in the inspector drawer and the board toolbar.
   */
  studioMode: boolean;
  setStudioMode: (on: boolean) => void;
  /** Rail collapsed to icons (legacy 折叠侧栏). */
  navCollapsed: boolean;
  setNavCollapsed: (on: boolean) => void;
  /** Studio mode: the panel inspector drawer is open. */
  inspectorOpen: boolean;
  setInspectorOpen: (on: boolean) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: SYSTEM,
      recentThemes: {},
      setTheme: (theme, mode) =>
        set((s) => ({
          theme,
          recentThemes:
            mode && theme !== SYSTEM ? { ...s.recentThemes, [mode]: theme } : s.recentThemes,
        })),
      variantId: null,
      setVariant: (variantId) => set({ variantId }),
      showRejected: false,
      setShowRejected: (showRejected) => set({ showRejected }),
      candidates: 2,
      setCandidates: (candidates) => set({ candidates }),
      studioMode: false,
      setStudioMode: (studioMode) => set({ studioMode }),
      navCollapsed: false,
      setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
      inspectorOpen: true,
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    }),
    {
      name: 'mio.ui',
      version: 1,
      partialize: (s) => ({
        theme: s.theme,
        recentThemes: s.recentThemes,
        candidates: s.candidates,
        studioMode: s.studioMode,
        navCollapsed: s.navCollapsed,
        inspectorOpen: s.inspectorOpen,
      }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<UIState>;
        return {
          ...state,
          theme: migrateChoice(state.theme),
          recentThemes: state.recentThemes ?? {},
        } as UIState;
      },
    },
  ),
);
