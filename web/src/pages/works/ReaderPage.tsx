import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useAlbumTemplates } from '../../api/open';
import { useEpisode, useEpisodes, useSeries } from '../../api/series';
import { Icon } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { gallerySearch } from '../../app/navigation';
import { shortcutBlocked } from '../../app/shortcuts';
import { QueryError } from '../../app/errors';
import { ownCancel } from '../../components/topLayer';
import { useUI } from '../../app/ui-store';
import { pickAdopted } from '../canvas/adopted';
import type { EpisodeContext } from '../episode/EpisodePage';
import { MotionExport } from '../episode/MotionExport';
import { PresentationDrawer, SlicePreview, TemplatePreview, useExportDraft } from './presentation';
import {
  DESKTOP_QUERY,
  READING_MODES,
  buildStages,
  readingMode,
  stageOf,
  type ReadingMode,
} from './readingStage';

const MODE_KEY = 'mio.reader.mode';
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
export default function ReaderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { seriesId } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const studio = useUI((s) => s.studioMode);
  const ref = useRef<HTMLDialogElement>(null);
  // The reading stage is remounted whenever the drawer swaps what the stage shows, so it is tracked
  // as state: measuring and scroll tracking re-attach to the new element.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const series = useSeries(seriesId);
  const episodes = useEpisodes(seriesId);
  const items = episodes.data?.items ?? [];
  const epId = params.get('ep') ?? items[0]?.id;
  const episode = useEpisode(epId);
  const [mode, setMode] = useState<ReadingMode>(() => readingMode(localStorage.getItem(MODE_KEY)));
  const [look, setLook] = useState<string>(() => {
    const saved = localStorage.getItem(LOOK_KEY) || NATIVE;
    return OLD_LOOKS[saved] ?? saved;
  });
  const templates = useAlbumTemplates();
  const [draft, setDraft] = useExportDraft();
  const captions = draft.captions;
  const [platformOpen, setPlatformOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const variantId = useUI((s) => s.variantId);
  const setVariant = useUI((s) => s.setVariant);
  const [page, setPage] = useState(0);
  const [info, setInfo] = useState(false);
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
  const [film, setFilm] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
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
  const panel = pathname.endsWith('/export')
    ? 'export'
    : pathname.endsWith('/layout')
      ? 'layout'
      : '';
  usePageTitle(series.data?.title ?? t('reader.title'));

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    return () => {
      d.close?.();
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  const pages = useMemo(() => {
    const ep = episode.data;
    if (!ep) return [];
    const images = pickAdopted(ep.takes, null);
    return [...ep.panels]
      .sort((a, b) => a.order - b.order)
      .filter((p) => images[p.id!])
      .map((p) => ({
        id: p.id!,
        asset: images[p.id!],
        title: p.description,
        caption:
          p.dialogues.find((d) => d.kind === 'narration')?.text ??
          p.dialogues.map((d) => d.text).join(' '),
        shape: (p.overrides.width ?? 0) > (p.overrides.height ?? Infinity) ? 'wide' : undefined,
      }));
  }, [episode.data]);
  const current = Math.min(page, Math.max(0, pages.length - 1));
  // Legacy reading-stage.js: fit each stage into one screen, except in continuous mode or on phones.
  const staged = desktop && mode !== 'continuous' && view.w > 0 && view.h > 0;
  const stages = useMemo(
    () =>
      staged
        ? buildStages(
            pages.map((p) => ({ id: p.id, caption: !!(captions && p.caption) })),
            sizes,
            mode,
            view,
          )
        : [],
    [staged, pages, sizes, mode, view, captions],
  );
  const stageAt = staged ? stageOf(stages, current) : -1;
  const range = staged && stages[stageAt] ? stages[stageAt].items.length : 1;
  const first = staged && stages[stageAt] ? stages[stageAt].start : current;

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
    scroller.scrollTo?.({ top, behavior: smooth && !reduced ? 'smooth' : 'instant' });
  };
  const pageRef = useRef(current);
  pageRef.current = current;
  // Switching mode (or a re-layout as images load) keeps the page in view, like legacy build().
  const layoutKey = `${epId}|${mode}|${staged}|${view.w}x${view.h}|${stages
    .map((x) => x.items.length)
    .join('')}|${pages.length}`;
  useLayoutEffect(() => {
    scrollTo(pageRef.current, false);
  }, [layoutKey, scroller]);

  // Track the page in view while scrolling: the last anchor whose top passed the reading line.
  useEffect(() => {
    const root = scroller;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = root.getBoundingClientRect().top;
        const line = top + Math.min(root.clientHeight * 0.35, 240);
        let index = 0;
        root.querySelectorAll<HTMLElement>('[data-page-anchor]').forEach((el) => {
          if (el.getBoundingClientRect().top <= line) index = Number(el.dataset.pageAnchor);
        });
        setPage((p) => (p === index ? p : index));
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', onScroll);
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
  const setLookSaved = (l: string) => {
    setLook(l);
    localStorage.setItem(LOOK_KEY, l);
  };
  /** One page of the native stage; continuous mode anchors on the page itself. */
  const renderPage = (
    i: number,
    opts: { className?: string; style?: CSSProperties; anchor?: boolean },
  ) => {
    const p = pages[i];
    const size = sizes[p.id];
    return (
      <article
        key={p.id}
        data-scroll-step={i}
        data-page-anchor={opts.anchor ? i : undefined}
        className={opts.className}
        style={
          opts.style ?? (size ? ({ '--native-w': `${size.w}px` } as CSSProperties) : undefined)
        }
        aria-label={opts.anchor ? t('reader.pageN', { n: i + 1 }) : undefined}
      >
        <div className="room-page" data-shape={p.shape}>
          <img
            src={assetUrl(p.asset, 1600)}
            alt={p.title}
            data-shape={p.shape}
            loading={i > 2 ? 'lazy' : undefined}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              setSizes((m) => (m[p.id] ? m : { ...m, [p.id]: { w, h } }));
            }}
          />
          <span className="room-page-number">{String(i + 1).padStart(2, '0')}</span>
        </div>
        {captions && p.caption ? <div className="scroll-caption">{p.caption}</div> : null}
      </article>
    );
  };
  const cur = pages[current];
  const native = look === NATIVE || !epId;
  const hintOf = (id: string) =>
    id === NATIVE
      ? t('reader.lookHint.fit')
      : id === 'export-seamless'
        ? t('reader.lookHint.seamless')
        : id === 'export-afterglow'
          ? t('reader.lookHint.afterglow')
          : t('reader.lookHint.html');
  const list = (
    templates.data?.length
      ? templates.data.map((x) => ({ id: x.id, title: x.title, description: x.description }))
      : BUILTIN.map((b) => ({ id: b.id, title: t(`reader.look.${b.look}`), description: '' }))
  ).sort((a, b) => Number(b.id === NATIVE) - Number(a.id === NATIVE));
  const lookTitle = list.find((x) => x.id === look)?.title ?? t('reader.look.fit');
  const variants = series.data?.variants ?? [];
  const activeVariant = studio && variants.some((v) => v.id === variantId) ? variantId : null;
  // What the stage shows while the drawer is open: the template, the platform cuts or motion setup.
  const drawerStage =
    panel !== 'export' ? '' : motionOpen && studio ? 'motion' : platformOpen ? 'platform' : '';
  // Reading mode, paging and the filmstrip drive the native stage only; templates, platform cuts,
  // motion and layout render elsewhere, where those controls would silently do nothing.
  const nativeStage = native && !drawerStage && panel !== 'layout';
  const templateStage = !native && !drawerStage && panel !== 'layout';
  const context =
    episode.data && series.data
      ? ({ episode: episode.data, series: series.data } satisfies EpisodeContext)
      : null;

  return (
    <dialog
      id="reader"
      ref={ref}
      className={`reader-dialog art-reader presentation-reader ${native ? '' : 'is-template'} ${
        panel === 'export' ? 'presentation-panel-open' : ''
      }`}
      aria-labelledby="reader-panel-label"
      data-mode={mode}
      onCancel={(e) => {
        // A dismissed file picker (版式 → 导入) or a nested dialog must not close the drawer.
        if (!ownCancel(e)) return;
        e.preventDefault();
        if (panel) navigate(`${base}${keep}`);
        else close();
      }}
    >
      {series.error || episodes.error || episode.error ? (
        <QueryError
          error={series.error || episodes.error || episode.error}
          onRetry={() => {
            void series.refetch();
            void episodes.refetch();
            void episode.refetch();
          }}
        />
      ) : null}
      <header className="room-head">
        <button
          type="button"
          className="ibtn"
          title={t('reader.close')}
          aria-label={t('reader.close')}
          onClick={close}
        >
          <Icon name="close" />
        </button>
        <span className="room-brand">Mio.</span>
        <span className="room-title grow" id="reader-panel-label">
          {series.data?.title}
          {items.length > 1 ? (
            <select
              className="room-episode"
              aria-label={t('reader.episode')}
              value={epId ?? ''}
              onChange={(e) => {
                setPage(0);
                const next = new URLSearchParams(params);
                next.set('ep', e.target.value);
                setParams(next, { replace: true });
              }}
            >
              {items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          ) : null}
        </span>
        <button
          type="button"
          className="btn small presentation-trigger"
          aria-expanded={panel === 'export'}
          aria-controls="presentation-drawer"
          onClick={() => togglePanel('export')}
        >
          <Icon name="book" sm />
          {t('reader.presentation', { look: lookTitle })}
        </button>
        <button
          type="button"
          className="ibtn"
          title={fullscreen ? t('reader.fullscreenExit') : t('reader.fullscreen')}
          aria-label={fullscreen ? t('reader.fullscreenExit') : t('reader.fullscreen')}
          aria-pressed={fullscreen}
          onClick={() => void toggleFullscreen()}
        >
          <Icon name="expand" />
        </button>
        <button
          type="button"
          className="btn small room-export"
          onClick={() => togglePanel('export')}
        >
          <Icon name="download" sm />
          {t('reader.export')}
        </button>
        {studio ? (
          <button
            type="button"
            className="btn small"
            aria-pressed={panel === 'layout'}
            onClick={() => togglePanel('layout')}
          >
            <Icon name="grid" sm />
            {t('reader.layout')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn small picture-reader-edit"
          disabled={!epId}
          title={t('reader.editHint')}
          onClick={() => {
            navigate(`/workshop/assembly/${epId}`);
          }}
        >
          <Icon name="edit" sm />
          {t('reader.edit')}
        </button>
      </header>
      <section className="room-stage">
        {panel === 'layout' && context ? (
          <div className="room-canvas room-layout workspace-body">
            <Outlet key={context.episode.id} context={context} />
          </div>
        ) : drawerStage === 'motion' && episode.data ? (
          <div className="room-canvas room-layout workspace-body">
            <MotionExport
              episode={episode.data}
              variantId={activeVariant}
              fallbackName={series.data?.title ?? 'motion'}
            />
          </div>
        ) : drawerStage === 'platform' && epId ? (
          <SlicePreview
            episodeId={epId}
            variantId={activeVariant}
            preset={draft.preset}
            revision={episode.data?.revision}
          />
        ) : !native && epId ? (
          <div className="room-canvas" id="reader-canvas">
            <TemplatePreview
              episodeId={epId}
              templateId={look}
              variantId={activeVariant}
              lettered={studio}
              draft={draft}
              revision={episode.data?.revision}
            />
          </div>
        ) : (
          <div
            className={`room-canvas ${staged ? 'mio-stage-root mio-stage-scroll' : ''}`}
            id="reader-canvas"
            ref={setScroller}
            data-reading-mode={mode}
            style={staged ? ({ '--mio-stage-height': `${view.h}px` } as CSSProperties) : undefined}
          >
            <div className={`room-scroll ${staged ? 'mio-stage-pages' : ''}`}>
              {episode.isLoading || series.isLoading ? (
                <p className="room-empty">{t('reader.loading')}</p>
              ) : !pages.length ? (
                <p className="room-empty">{t('reader.empty')}</p>
              ) : staged ? (
                stages.map((stage) => (
                  <section
                    key={pages[stage.start].id}
                    className="mio-reading-stage"
                    data-count={stage.items.length}
                    data-page-anchor={stage.start}
                    aria-label={
                      stage.items.length > 1
                        ? t('reader.pagesN', { from: stage.start + 1, to: stage.start + 2 })
                        : t('reader.pageN', { n: stage.start + 1 })
                    }
                    style={
                      {
                        '--mio-stage-backdrop': `url("${assetUrl(pages[stage.start].asset, 512)}")`,
                      } as CSSProperties
                    }
                  >
                    {stage.items.map((item) =>
                      renderPage(item.index, {
                        className: 'mio-stage-item',
                        style: {
                          '--mio-image-width': `${item.w}px`,
                          '--mio-image-height': `${item.h}px`,
                        } as CSSProperties,
                      }),
                    )}
                  </section>
                ))
              ) : (
                pages.map((_, i) => renderPage(i, { anchor: true }))
              )}
              {pages.length ? (
                <div
                  className={`mio-colophon ${staged ? 'mio-stage-ending' : ''}`}
                  data-mio-colophon
                  role="contentinfo"
                >
                  <p>
                    {t('reader.colophon1')}
                    <br />
                    {t('reader.colophon2')}
                  </p>
                  <a
                    href="https://github.com/lumingya/comfy-comic-studio"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Mio · github.com/lumingya/comfy-comic-studio
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {cur && !info && nativeStage ? (
          <button type="button" className="room-open-details" onClick={() => setInfo(true)}>
            <Icon name="eye" sm />
            {t('reader.info')}
          </button>
        ) : null}
        {cur && nativeStage ? (
          <aside className="room-info" id="room-info" hidden={!info} aria-label={t('reader.info')}>
            <h3>{cur.title || t('reader.pageN', { n: current + 1 })}</h3>
            <p>{cur.caption || t('reader.noCaption')}</p>
          </aside>
        ) : null}
      </section>
      <div
        className="room-filmstrip"
        id="room-filmstrip"
        hidden={!film || !nativeStage}
        aria-label={t('reader.film')}
      >
        {pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={i === current ? 'active' : ''}
            aria-label={t('reader.pageN', { n: i + 1 })}
            onClick={() => go(i)}
          >
            <img src={assetUrl(p.asset, 256)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {fullscreenHint ? (
        <div id="reader-fullscreen-hint" className="reader-fullscreen-hint" role="status">
          <span>{t('reader.fullscreenHint')}</span>
          <button type="button" className="btn small" onClick={() => setFullscreenHint(false)}>
            {t('reader.gotIt')}
          </button>
        </div>
      ) : null}
      <footer className="room-footer">
        {nativeStage ? (
          <>
            <span className="native-reading-controls">
              {READING_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  data-mode={m}
                  aria-pressed={mode === m}
                  onClick={() => setModeSaved(m)}
                >
                  {t(`reader.mode.${m}`)}
                </button>
              ))}
            </span>
            <span className="spacer" />
            <div className="room-pagination">
              <button
                type="button"
                className="ibtn"
                title={t('reader.prev')}
                aria-label={t('reader.prev')}
                disabled={first <= 0}
                onClick={() => step(-1)}
              >
                <Icon name="up" />
              </button>
              <span className="page-label" id="page-position">
                {String(pages.length ? first + 1 : 0).padStart(2, '0')}
                {range > 1 ? `–${String(first + range).padStart(2, '0')}` : ''} /{' '}
                {String(pages.length).padStart(2, '0')}
              </span>
              <button
                type="button"
                className="ibtn"
                title={t('reader.next')}
                aria-label={t('reader.next')}
                disabled={first + range >= pages.length}
                onClick={() => step(1)}
              >
                <Icon name="down" />
              </button>
            </div>
            <span className="spacer" />
          </>
        ) : (
          <span className="spacer" />
        )}
        <span className="room-scene-title">{nativeStage ? cur?.title : null}</span>
        {nativeStage ? (
          <>
            <button
              type="button"
              className="ibtn"
              title={t('reader.film')}
              aria-label={t('reader.film')}
              aria-pressed={film}
              onClick={() => setFilm(!film)}
            >
              <Icon name="list" />
            </button>
            <button
              type="button"
              className="ibtn"
              title={t('reader.info')}
              aria-label={t('reader.info')}
              aria-pressed={info}
              onClick={() => setInfo(!info)}
            >
              <Icon name="help" />
            </button>
          </>
        ) : null}
      </footer>
      <PresentationDrawer
        open={panel === 'export'}
        onClose={() => navigate(`${base}${keep}`)}
        templates={list}
        infos={templates.data ?? []}
        look={look}
        native={NATIVE}
        onLook={setLookSaved}
        hintOf={hintOf}
        draft={draft}
        onDraft={setDraft}
        mode={mode}
        onMode={setModeSaved}
        episodeId={epId}
        title={series.data?.title ?? ''}
        lettered={studio}
        variants={variants}
        variantId={activeVariant}
        onVariant={setVariant}
        platformOpen={platformOpen}
        onPlatform={setPlatformOpen}
        studio={studio}
        motionOpen={motionOpen}
        onMotion={setMotionOpen}
      />
    </dialog>
  );
}
