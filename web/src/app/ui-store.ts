import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateChoice, SYSTEM, type ThemeChoice } from './theme';
import type { NativeLayout } from '../pages/works/readingStage';

export const LETTERING_OPTS = ['editorial', 'calligraphy', 'classic'] as const;
export type LetteringStyle = (typeof LETTERING_OPTS)[number];

interface UIState {
  /** 'system' or a theme id (see app/theme.ts). */
  theme: ThemeChoice;
  /** Last explicit theme id per mode, for the quick toggle (see theme.toggled). */
  recentThemes: Partial<Record<'dark' | 'light', string>>;
  setTheme: (theme: ThemeChoice, mode?: 'dark' | 'light') => void;
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
  /**
   * 功能开关: professional tools switched off one by one inside Studio mode (legacy granular
   * feature switches).  Stored as the *off* list so tools added later start switched on.
   */
  studioOff: StudioFeature[];
  setStudioFeature: (feature: StudioFeature, on: boolean) => void;
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
  /** 画册排序 (legacy collectionSort), remembered on this device. */
  shelfSort: ShelfSort;
  setShelfSort: (sort: ShelfSort) => void;
  /** 手动排序: album ids in the order dragged on the shelf (legacy bookOrder). */
  shelfOrder: string[];
  setShelfOrder: (ids: string[]) => void;
  /** Home: the GET STARTED guide is folded away (legacy 收起指引). */
  homeGuideHidden: boolean;
  setHomeGuideHidden: (on: boolean) => void;
  /** 界面密度 (legacy appearance.density). */
  density: DisplayDensity;
  setDensity: (v: DisplayDensity) => void;
  /** 界面字号 (legacy appearance.fontScale). */
  fontScale: DisplayFontScale;
  setFontScale: (v: DisplayFontScale) => void;
  /** 减少动态效果 (legacy appearance.reduceMotion). */
  reduceMotion: boolean;
  setReduceMotion: (on: boolean) => void;
  /** 艺术字体风格 (legacy presentation.lettering). */
  lettering: LetteringStyle;
  setLettering: (v: LetteringStyle) => void;
  /** 阅读与翻页: the default reader layout (legacy presentation.defaultReaderMode). */
  defaultReaderMode: NativeLayout;
  setDefaultReaderMode: (v: NativeLayout) => void;
}

export type WorksView = 'showcase' | 'grid';

/** Legacy 界面密度. */
export const DENSITY_OPTS = ['comfortable', 'compact'] as const;
export type DisplayDensity = (typeof DENSITY_OPTS)[number];
/** Legacy 界面字号. */
export const FONT_SCALE_OPTS = ['standard', 'large', 'xlarge'] as const;
export type DisplayFontScale = (typeof FONT_SCALE_OPTS)[number];

/** Legacy 画册排序 options; 手动排序 is the order dragged on the shelf. */
export const SHELF_SORTS = ['manual', 'createdAt', 'updatedAt', 'totalSteps'] as const;
export type ShelfSort = (typeof SHELF_SORTS)[number];

/** The professional tools Studio mode adds, each with its own switch in 设置 → 功能开关. */
export const STUDIO_FEATURES = ['script', 'layout'] as const;
export type StudioFeature = (typeof STUDIO_FEATURES)[number];

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
      showRejected: false,
      setShowRejected: (showRejected) => set({ showRejected }),
      candidates: 2,
      setCandidates: (candidates) => set({ candidates }),
      studioMode: false,
      setStudioMode: (studioMode) => set({ studioMode }),
      studioOff: [],
      setStudioFeature: (feature, on) =>
        set((s) => ({
          studioOff: on
            ? s.studioOff.filter((x) => x !== feature)
            : [...new Set([...s.studioOff, feature])],
        })),
      navCollapsed: false,
      setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
      inspectorOpen: true,
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      worksView: 'showcase',
      setWorksView: (worksView) => set({ worksView }),
      homeGuideHidden: false,
      setHomeGuideHidden: (homeGuideHidden) => set({ homeGuideHidden }),
      shelfSort: 'createdAt',
      setShelfSort: (shelfSort) => set({ shelfSort }),
      shelfOrder: [],
      setShelfOrder: (shelfOrder) => set({ shelfOrder }),
      density: 'comfortable',
      setDensity: (density) => set({ density }),
      fontScale: 'standard',
      setFontScale: (fontScale) => set({ fontScale }),
      reduceMotion: false,
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      lettering: 'editorial',
      setLettering: (lettering) => set({ lettering }),
      defaultReaderMode: 'webtoon',
      setDefaultReaderMode: (defaultReaderMode) => set({ defaultReaderMode }),
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
        studioOff: s.studioOff,
        navCollapsed: s.navCollapsed,
        inspectorOpen: s.inspectorOpen,
        worksView: s.worksView,
        starred: s.starred,
        shelfSort: s.shelfSort,
        shelfOrder: s.shelfOrder,
        homeGuideHidden: s.homeGuideHidden,
        density: s.density,
        fontScale: s.fontScale,
        reduceMotion: s.reduceMotion,
        lettering: s.lettering,
        defaultReaderMode: s.defaultReaderMode,
      }),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<UIState>;
        return {
          ...state,
          theme: migrateChoice(state.theme),
          recentThemes: state.recentThemes ?? {},
          worksView: state.worksView === 'grid' ? 'grid' : 'showcase',
          starred: Array.isArray(state.starred) ? state.starred : [],
          shelfSort: (SHELF_SORTS as readonly string[]).includes(state.shelfSort ?? '')
            ? state.shelfSort
            : 'createdAt',
          shelfOrder: Array.isArray(state.shelfOrder) ? state.shelfOrder : [],
          density: DENSITY_OPTS.includes(state.density as DisplayDensity)
            ? (state.density as DisplayDensity)
            : 'comfortable',
          fontScale: FONT_SCALE_OPTS.includes(state.fontScale as DisplayFontScale)
            ? (state.fontScale as DisplayFontScale)
            : 'standard',
          reduceMotion: !!state.reduceMotion,
          lettering: LETTERING_OPTS.includes(state.lettering as LetteringStyle)
            ? (state.lettering as LetteringStyle)
            : 'editorial',
          defaultReaderMode: (['webtoon', 'gallery', 'spread'] as const).includes(
            state.defaultReaderMode as NativeLayout,
          )
            ? (state.defaultReaderMode as NativeLayout)
            : 'webtoon',
          studioOff: Array.isArray(state.studioOff)
            ? state.studioOff.filter((x) => (STUDIO_FEATURES as readonly string[]).includes(x))
            : [],
        } as UIState;
      },
    },
  ),
);

/**
 * Whether a professional tool shows: Studio mode is on and that tool is not switched off in
 * 功能开关.  Without a feature: Studio mode itself.
 */
export function useStudio(feature?: StudioFeature): boolean {
  return useUI((s) => s.studioMode && (!feature || !s.studioOff.includes(feature)));
}
