import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useEpisode, useEpisodes, useSeries } from '../../api/series';
import { Icon } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { pickAdopted } from '../canvas/adopted';
import type { EpisodeContext } from '../episode/EpisodePage';

type Mode = 'auto' | 'single' | 'continuous';
type Look = 'fit' | 'seamless';
const MODE_KEY = 'mio.reader.mode';
const LOOK_KEY = 'mio.reader.look';

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
  const scroller = useRef<HTMLDivElement>(null);
  const series = useSeries(seriesId);
  const episodes = useEpisodes(seriesId);
  const items = episodes.data?.items ?? [];
  const epId = params.get('ep') ?? items[0]?.id;
  const episode = useEpisode(epId);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || 'auto');
  const [look, setLook] = useState<Look>(() => (localStorage.getItem(LOOK_KEY) as Look) || 'fit');
  const [captions, setCaptions] = useState(true);
  const [page, setPage] = useState(0);
  const [info, setInfo] = useState(false);
  const [film, setFilm] = useState(false);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const measure = () => setView({ w: root.clientWidth, h: root.clientHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [episode.data]);
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
  const single = mode === 'single';

  // Track the page in view while scrolling.
  useEffect(() => {
    const root = scroller.current;
    if (!root || single || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setPage(Number((e.target as HTMLElement).dataset.scrollStep));
      },
      { root, threshold: 0.55 },
    );
    root.querySelectorAll('.mio-stage-item').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages, single]);

  const go = (n: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, n));
    setPage(next);
    if (!single)
      scroller.current
        ?.querySelector(`[data-scroll-step="${next}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const close = () => {
    ref.current?.close?.();
    navigate('/gallery');
  };
  const base = `/gallery/${seriesId}`;
  const keep = epId && params.get('ep') ? `?ep=${epId}` : '';
  const togglePanel = (to: 'export' | 'layout') =>
    navigate(panel === to ? `${base}${keep}` : `${base}/${to}${keep}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(current + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(current - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setModeSaved = (m: Mode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };
  const setLookSaved = (l: Look) => {
    setLook(l);
    localStorage.setItem(LOOK_KEY, l);
  };
  const shown = single ? pages.slice(current, current + 1) : pages;
  // Legacy reading-stage.js: fit each page into one screen (except in continuous mode).
  const staged = mode !== 'continuous' && view.w > 0;
  const fit = (id: string, caption: boolean) => {
    const d = sizes[id];
    if (!staged || !d) return null;
    const pad = 16;
    const maxH = Math.max(100, view.h - pad - 16 - (caption ? 80 : 0));
    const maxW = view.w - pad * 2;
    const scale = Math.min(1, maxW / d.w, maxH / d.h);
    return { w: d.w * scale, h: d.h * scale };
  };
  const cur = pages[current];
  const context =
    episode.data && series.data
      ? ({ episode: episode.data, series: series.data } satisfies EpisodeContext)
      : null;

  return (
    <dialog
      id="reader"
      ref={ref}
      className={`reader-dialog art-reader presentation-reader is-${look}`}
      aria-labelledby="reader-panel-label"
      data-mode={mode}
      onCancel={(e) => {
        e.preventDefault();
        if (panel) navigate(`${base}${keep}`);
        else close();
      }}
    >
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
                setParams({ ep: e.target.value }, { replace: true });
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
          {t('reader.presentation', { look: t(`reader.look.${look}`) })}
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('reader.fullscreen')}
          aria-label={t('reader.fullscreen')}
          onClick={() =>
            document.fullscreenElement
              ? document.exitFullscreen()
              : ref.current?.requestFullscreen?.()
          }
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
            ref.current?.close?.();
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
            <Outlet context={context} />
          </div>
        ) : (
          <div
            className={`room-canvas ${staged ? 'mio-stage-root mio-stage-scroll' : ''}`}
            id="reader-canvas"
            ref={scroller}
            style={staged ? ({ '--mio-stage-height': `${view.h}px` } as CSSProperties) : undefined}
          >
            <div className="room-scroll mio-stage-pages">
              {episode.isLoading || series.isLoading ? (
                <p className="room-empty">{t('reader.loading')}</p>
              ) : !pages.length ? (
                <p className="room-empty">{t('reader.empty')}</p>
              ) : (
                shown.map((p) => {
                  const i = pages.indexOf(p);
                  const box = fit(p.id, !!(captions && p.caption));
                  return (
                    <section
                      key={p.id}
                      className="mio-reading-stage"
                      data-count="1"
                      aria-label={t('reader.pageN', { n: i + 1 })}
                      style={
                        {
                          '--mio-stage-backdrop': `url("${assetUrl(p.asset, 512)}")`,
                        } as CSSProperties
                      }
                    >
                      <article
                        data-scroll-step={i}
                        className="mio-stage-item"
                        style={
                          box
                            ? ({
                                '--mio-image-width': `${box.w}px`,
                                '--mio-image-height': `${box.h}px`,
                              } as CSSProperties)
                            : undefined
                        }
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
                        {captions && p.caption ? (
                          <div className="scroll-caption">{p.caption}</div>
                        ) : null}
                      </article>
                    </section>
                  );
                })
              )}
              {pages.length && (!single || current === pages.length - 1) ? (
                <div className="mio-colophon mio-stage-ending" role="contentinfo">
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
        {cur && !info ? (
          <button type="button" className="room-open-details" onClick={() => setInfo(true)}>
            <Icon name="eye" sm />
            {t('reader.info')}
          </button>
        ) : null}
        {cur ? (
          <aside className="room-info" id="room-info" hidden={!info} aria-label={t('reader.info')}>
            <h3>{cur.title || t('reader.pageN', { n: current + 1 })}</h3>
            <p>{cur.caption || t('reader.noCaption')}</p>
          </aside>
        ) : null}
      </section>
      <div
        className="room-filmstrip"
        id="room-filmstrip"
        hidden={!film}
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
      <footer className="room-footer">
        <span className="native-reading-controls">
          {(['auto', 'single', 'continuous'] as const).map((m) => (
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
            disabled={current <= 0}
            onClick={() => go(current - 1)}
          >
            <Icon name="up" />
          </button>
          <span className="page-label" id="page-position">
            {String(pages.length ? current + 1 : 0).padStart(2, '0')} /{' '}
            {String(pages.length).padStart(2, '0')}
          </span>
          <button
            type="button"
            className="ibtn"
            title={t('reader.next')}
            aria-label={t('reader.next')}
            disabled={current >= pages.length - 1}
            onClick={() => go(current + 1)}
          >
            <Icon name="down" />
          </button>
        </div>
        <span className="spacer" />
        <span className="room-scene-title">{cur?.title}</span>
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
      </footer>
      <aside
        className="presentation-drawer"
        id="presentation-drawer"
        hidden={panel !== 'export'}
        aria-label={t('reader.drawer')}
      >
        <header>
          <div>
            <small>PRESENTATION STUDIO</small>
            <h2>{t('reader.drawerTitle')}</h2>
          </div>
          <button
            type="button"
            className="ibtn"
            title={t('reader.drawerClose')}
            aria-label={t('reader.drawerClose')}
            onClick={() => navigate(`${base}${keep}`)}
          >
            <Icon name="close" />
          </button>
        </header>
        <div id="presentation-template-list">
          {(['fit', 'seamless'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`presentation-choice ${look === l ? 'selected' : ''}`}
              aria-pressed={look === l}
              onClick={() => setLookSaved(l)}
            >
              <span className="presentation-swatch">
                <Icon name={l === 'fit' ? 'image' : 'grid'} />
              </span>
              <span>
                <strong>{t(`reader.look.${l}`)}</strong>
                <small>{t(`reader.lookHint.${l}`)}</small>
              </span>
              {look === l ? <Icon name="check" /> : null}
            </button>
          ))}
        </div>
        <details className="presentation-options" open>
          <summary>{t('reader.options')}</summary>
          <label>
            <input
              type="checkbox"
              checked={captions}
              onChange={(e) => setCaptions(e.target.checked)}
            />{' '}
            {t('reader.captions')}
          </label>
        </details>
        <div className="presentation-export">
          {panel === 'export' && context ? <Outlet context={context} /> : null}
        </div>
      </aside>
    </dialog>
  );
}
