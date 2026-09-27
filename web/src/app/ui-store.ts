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
  /** Works page layout: one featured book at a time (legacy 精选展示) or the compact grid. */
  worksView: WorksView;
  setWorksView: (view: WorksView) => void;
  /** Starred series ids (legacy 星标收藏; kept on this device). */
  starred: string[];
  toggleStar: (id: string) => void;
  /** Home: the GET STARTED guide is folded away (legacy 收起指引). */
  homeGuideHidden: boolean;
  setHomeGuideHidden: (on: boolean) => void;
}

export type WorksView = 'showcase' | 'grid';

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
      worksView: 'showcase',
      setWorksView: (worksView) => set({ worksView }),
      homeGuideHidden: false,
      setHomeGuideHidden: (homeGuideHidden) => set({ homeGuideHidden }),
      starred: [],
      toggleStar: (id) =>
        set((s) => ({
          starred: s.starred.includes(id) ? s.starred.filter((x) => x !== id) : [...s.starred, id],
        })),
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
        worksView: s.worksView,
        starred: s.starred,
        homeGuideHidden: s.homeGuideHidden,
      }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<UIState>;
        return {
          ...state,
          theme: migrateChoice(state.theme),
          recentThemes: state.recentThemes ?? {},
          worksView: state.worksView === 'grid' ? 'grid' : 'showcase',
          starred: Array.isArray(state.starred) ? state.starred : [],
        } as UIState;
      },
    },
  ),
);
