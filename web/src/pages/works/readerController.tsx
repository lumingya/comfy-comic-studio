import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { readingPanelUrl, useReadingPreview } from '../../api/production';
import { useAlbumTemplates } from '../../api/open';
import { useEpisode, useEpisodes, useSeries } from '../../api/series';
import { usePageTitle } from '../../app/title';
import { gallerySearch } from '../../app/navigation';
import { shortcutBlocked } from '../../app/shortcuts';
import { useUI } from '../../app/ui-store';
import { pickAdopted } from '../canvas/adopted';
import type { EpisodeContext } from '../episode/EpisodePage';
import { useExportDraft } from './presentation';
import { templateRank } from './templateFile';
import {
  buildStages,
  hasSavedReadingLayout,
  nativeLayout,
  readingMode,
  stageMode,
  stageOf,
  type NativeLayout,
  type ReadingMode,
} from './readingStage';
import { useReaderEnvironment } from './readerEnvironment';

const MODE_KEY = 'mio.reader.mode';
const LAYOUT_KEY = 'mio.reader.layout';
const LOOK_KEY = 'mio.reader.look';
/** The native reading stage (legacy mio-fit); every other template renders in a sandboxed preview. */
const NATIVE = 'mio-fit';
const OLD_LOOKS: Record<string, string> = { fit: NATIVE, seamless: 'export-seamless' };
const BUILTIN = [
  { id: NATIVE, look: 'fit' },
  { id: 'export-seamless', look: 'seamless' },
] as const;

/**
 * The legacy reader (画册阅读室): a full-screen dialog over 画册集. Reading only — 版式 / 导出
 * open the presentation drawer, 编辑图片 goes to the album's candidates in 创作工坊.
 */
export function useReaderController() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { seriesId } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const ref = useRef<HTMLDialogElement>(null);
  // The reading stage is remounted whenever the drawer swaps what the stage shows, so it is tracked
  // as state: measuring and scroll tracking re-attach to the new element.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const series = useSeries(seriesId);
  const episodes = useEpisodes(seriesId);
  const items = episodes.data?.items ?? [];
  const epId = params.get('ep') ?? items[0]?.id;
  const episode = useEpisode(epId);
  const savedLayout = hasSavedReadingLayout(episode.data?.strip);
  const [mode, setMode] = useState<ReadingMode>(() => readingMode(localStorage.getItem(MODE_KEY)));
  const storeLayout = useUI((s) => s.defaultReaderMode);
  const [layout, setLayout] = useState<NativeLayout>(() => {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return nativeLayout(stored || storeLayout);
  });
  const stage = stageMode(layout, mode);
  const [pickedLook, setLook] = useState<string>(() => {
    const saved = localStorage.getItem(LOOK_KEY) || NATIVE;
    return OLD_LOOKS[saved] ?? saved;
  });
  const templates = useAlbumTemplates();
  const look =
    pickedLook === NATIVE || !templates.isSuccess
      ? NATIVE
      : templates.data.some((template) => template.id === pickedLook)
        ? pickedLook
        : (templates.data.find((template) => template.id === 'export-monograph')?.id ?? NATIVE);
  useEffect(() => {
    if (templates.isSuccess && look !== pickedLook) {
      setLook(look);
      localStorage.setItem(LOOK_KEY, look);
    }
  }, [look, pickedLook, templates.isSuccess]);
  const [draft, setDraft] = useExportDraft();
  const captions = draft.captions;
  const [platformOpen, setPlatformOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [info, setInfo] = useState(false);
  const [film, setFilm] = useState(false);
  const [loadedSizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const environment = useReaderEnvironment(ref, scroller);
  const { view, desktop } = environment;
  const panel = pathname.endsWith('/export')
    ? 'export'
    : pathname.endsWith('/layout')
      ? 'layout'
      : '';
  usePageTitle(series.data?.title ?? t('reader.title'));
  const reading = useReadingPreview(
    episode.data,
    series.data,
    look === NATIVE && panel !== 'layout',
  );

  const pages = useMemo(() => {
    const ep = episode.data;
    if (!ep) return [];
    const images = pickAdopted(ep.takes);
    return [...ep.panels]
      .sort((a, b) => a.order - b.order)
      .filter((p) => images[p.id!])
      .map((p) => ({
        id: p.id!,
        src: reading.data ? readingPanelUrl(ep.id, p.id, reading.data.revision) : '',
        title: p.description,
        caption: reading.data?.captions[p.id] ?? '',
        displayCaption: draft.deduplicateCaptions
          ? (reading.data?.display_captions?.[p.id] ?? reading.data?.captions[p.id] ?? '')
          : (reading.data?.captions[p.id] ?? ''),
      }));
  }, [episode.data, reading.data, draft.deduplicateCaptions]);
  const currentSources = useRef(new Map<string, string>());
  currentSources.current = new Map(pages.map((p) => [p.id, p.src]));
  const sizes = useMemo(
    () =>
      Object.fromEntries(
        pages.map((p) => {
          const box = reading.data?.panel_boxes[p.id];
          return [
            p.id,
            loadedSizes[p.src] ?? (box ? { w: box[2] - box[0], h: box[3] - box[1] } : undefined),
          ];
        }),
      ),
    [pages, loadedSizes, reading.data],
  );
  const current = Math.min(page, Math.max(0, pages.length - 1));
  // Legacy reading-stage.js: fit each stage into one screen, except in continuous mode or on phones.
  const staged = desktop && stage !== 'continuous' && view.w > 0 && view.h > 0;
  const stages = useMemo(
    () =>
      staged
        ? buildStages(
            pages.map((p) => ({ id: p.id, caption: !!(captions && p.displayCaption) })),
            sizes,
            stage,
            view,
          )
        : [],
    [staged, pages, sizes, stage, view, captions],
  );
  const stageAt = staged ? stageOf(stages, current) : -1;
  const range = staged && stages[stageAt] ? stages[stageAt].items.length : 1;
  const first = staged && stages[stageAt] ? stages[stageAt].start : current;
  const scrollingTo = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!scroller) return;
    // Image decoding changes article heights. Browser anchoring must not move the
    // reader away from the page that its own navigation has selected.
    const anchor = scroller.style.overflowAnchor;
    scroller.style.overflowAnchor = 'none';
    return () => {
      scroller.style.overflowAnchor = anchor;
    };
  }, [scroller]);

  const anchorOf = (index: number) => {
    if (!scroller) return null;
    const target = staged ? stages[stageOf(stages, index)]?.start : index;
    return target === undefined
      ? null
      : scroller.querySelector<HTMLElement>(`[data-page-anchor="${target}"]`);
  };
  const scrollTo = (index: number, smooth: boolean) => {
    const el = anchorOf(index);
    if (!scroller || !el) return;
    const top =
      el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const destination = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
    scrollingTo.current = Math.abs(scroller.scrollTop - destination) > 1 ? index : null;
    scroller.scrollTo?.({ top, behavior: smooth && !reduced ? 'smooth' : 'instant' });
  };
  const pageRef = useRef(current);
  pageRef.current = current;
  // Switching mode (or a re-layout as images load) keeps the page in view, like legacy build().
  const layoutKey = `${epId}|${reading.data?.revision}|${stage}|${staged}|${view.w}x${view.h}|${stages
    .map((x) => x.items.length)
    .join('')}|${pages.length}`;
  useLayoutEffect(() => {
    scrollTo(pageRef.current, false);
  }, [layoutKey, scroller]);

  // Navigation places an anchor at the top. Use that same line during ordinary
  // scrolling so several short mobile panels cannot count as one page turn.
  useEffect(() => {
    const root = scroller;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (scrollingTo.current !== null) return;
        const top = root.getBoundingClientRect().top;
        const line = top + 1; // fractional scroll offsets are rounded by the browser
        let index = 0;
        root.querySelectorAll<HTMLElement>('[data-page-anchor]').forEach((el) => {
          if (el.getBoundingClientRect().top <= line) index = Number(el.dataset.pageAnchor);
        });
        setPage((p) => (p === index ? p : index));
      });
    };
    const endScroll = () => {
      if (scrollingTo.current !== null) {
        cancelAnimationFrame(raf);
        scrollingTo.current = null;
      } else onScroll();
    };
    const manualScroll = () => {
      scrollingTo.current = null;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', endScroll);
    root.addEventListener('wheel', manualScroll, { passive: true });
    root.addEventListener('touchstart', manualScroll, { passive: true });
    root.addEventListener('pointerdown', manualScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', endScroll);
      root.removeEventListener('wheel', manualScroll);
      root.removeEventListener('touchstart', manualScroll);
      root.removeEventListener('pointerdown', manualScroll);
    };
  }, [scroller]);

  const go = (n: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, n));
    setPage(next);
    scrollTo(next, true);
  };
  /** Previous / next screen: a whole stage when staged, one page otherwise. */
  const step = (direction: 1 | -1) => {
    if (!staged) return go(current + direction);
    const target = stages[Math.max(0, Math.min(stages.length - 1, stageAt + direction))];
    if (target) go(target.start);
  };
  const close = () => {
    // Let successful navigation unmount the dialog. Closing it here would defeat a dirty-canvas blocker.
    navigate(`/gallery${gallerySearch(params)}`);
  };
  const base = `/gallery/${seriesId}`;
  const keep = params.size ? `?${params}` : '';
  const togglePanel = (to: 'export' | 'layout') =>
    navigate(panel === to ? `${base}${keep}` : `${base}/${to}${keep}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (templateStage && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        // Legacy installPresentationStudio: a template turns its own spreads (交互画册).
        if (shortcutBlocked(e, ref.current)) return;
        const frame = ref.current?.querySelector<HTMLIFrameElement>('#reader-canvas iframe');
        if (!frame?.contentWindow) return;
        e.preventDefault();
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        frame.contentWindow.postMessage({ type: 'mio-reader-turn', direction }, '*');
        return;
      }
      if (!nativeStage || panel || shortcutBlocked(e, ref.current)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') step(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setModeSaved = (m: ReadingMode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };
  const setLayoutSaved = (l: NativeLayout) => {
    setLayout(l);
    localStorage.setItem(LAYOUT_KEY, l);
  };
  const setLookSaved = (l: string) => {
    setLook(l);
    localStorage.setItem(LOOK_KEY, l);
  };
  const cur = pages[current];
  const native = look === NATIVE || !epId;
  const list = (
    templates.data?.length
      ? templates.data.map((x) => ({
          id: x.id,
          title: x.title,
          description: x.description,
          accent: x.options?.accent,
          layout: x.layout,
          layoutName: x.layout_name,
        }))
      : BUILTIN.map((b) => ({ id: b.id, title: t(`reader.look.${b.look}`), description: '' }))
  ).sort((a, b) => templateRank(a.id) - templateRank(b.id));
  // What the stage shows while the drawer is open: the template or the platform cuts.
  const drawerStage = panel === 'export' && platformOpen ? 'platform' : '';
  // Reading mode, paging and the filmstrip drive the native stage only; templates, platform cuts
  // and layout render elsewhere, where those controls would silently do nothing.
  const nativeStage = native && !drawerStage && panel !== 'layout';
  const templateStage = !native && !drawerStage && panel !== 'layout';
  const context =
    episode.data && series.data
      ? ({ episode: episode.data, series: series.data } satisfies EpisodeContext)
      : null;

  return {
    ...environment,
    panel,
    t,
    navigate,
    seriesId,
    params,
    setParams,
    ref,
    series,
    episodes,
    items,
    epId,
    episode,
    savedLayout,
    mode,
    layout,
    stage,
    look,
    templates,
    draft,
    setDraft,
    setPlatformOpen,
    setPage,
    info,
    setInfo,
    film,
    setFilm,
    view,
    reading,
    pages,
    currentSources,
    setSizes,
    sizes,
    current,
    staged,
    stages,
    range,
    first,
    go,
    step,
    close,
    base,
    keep,
    togglePanel,
    setModeSaved,
    setLayoutSaved,
    setLookSaved,
    cur,
    native,
    list,
    drawerStage,
    nativeStage,
    templateStage,
    context,
    setScroller,
    captions,
  };
}

export type ReaderState = ReturnType<typeof useReaderController>;
