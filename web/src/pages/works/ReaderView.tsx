import type { CSSProperties } from 'react';
import { Outlet } from 'react-router-dom';
import { readingPanelUrl, readingStripUrl } from '../../api/production';
import { Icon } from '../../app/icons';
import { QueryError } from '../../app/errors';
import { ownCancel } from '../../components/topLayer';
import { SlicePreview, TemplatePreview } from './presentation';
import { PresentationDrawer } from './ExportDrawer';
import { READING_MODES } from './readingStage';
import { ReaderHeader } from './ReaderHeader';
import type { ReaderState } from './readerController';

const NATIVE = 'mio-fit';

export function ReaderView({ reader }: { reader: ReaderState }) {
  const {
    t,
    navigate,
    seriesId,
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
    setModeSaved,
    setLayoutSaved,
    setLookSaved,
    cur,
    native,
    list,
    drawerStage,
    nativeStage,
    context,
    setScroller,
    captions,
    fullscreenHint,
    setFullscreenHint,
    panel,
  } = reader;
  /** One page of the native stage; continuous mode anchors on the page itself. */
  const renderPage = (
    i: number,
    opts: { className?: string; style?: CSSProperties; anchor?: boolean },
  ) => {
    const p = pages[i];
    const size = sizes[p.id];
    const shape = size && size.w > size.h ? 'wide' : undefined;
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
        <div className="room-page" data-shape={shape}>
          <img
            key={p.src}
            src={p.src}
            alt={p.title}
            data-shape={shape}
            loading={i > 2 ? 'lazy' : undefined}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (currentSources.current.get(p.id) !== p.src || !w || !h) return;
              setSizes((m) =>
                m[p.src]?.w === w && m[p.src]?.h === h ? m : { ...m, [p.src]: { w, h } },
              );
            }}
          />
          <span className="room-page-number">{String(i + 1).padStart(2, '0')}</span>
        </div>
        {captions && p.displayCaption ? (
          <div className="scroll-caption">{p.displayCaption}</div>
        ) : null}
      </article>
    );
  };
  return (
    <dialog
      id="reader"
      ref={ref}
      className={`reader-dialog art-reader presentation-reader ${native ? '' : 'is-template'} ${
        panel === 'export' ? 'presentation-panel-open' : ''
      }`}
      aria-labelledby="reader-panel-label"
      data-mode={stage}
      data-reader-view={panel === 'layout' ? 'layout' : nativeStage ? 'native' : 'preview'}
      onCancel={(e) => {
        // A dismissed file picker (版式 → 导入) or a nested dialog must not close the drawer.
        if (!ownCancel(e)) return;
        e.preventDefault();
        if (panel) navigate(`${base}${keep}`);
        else close();
      }}
    >
      {series.error || episodes.error || episode.error || reading.error ? (
        <QueryError
          error={series.error || episodes.error || episode.error || reading.error}
          onRetry={() => {
            void series.refetch();
            void episodes.refetch();
            void episode.refetch();
            void reading.refetch();
          }}
        />
      ) : null}
      <ReaderHeader reader={reader} />
      <section className="room-stage">
        {panel === 'layout' && context ? (
          <div className="room-canvas room-layout workspace-body">
            <Outlet key={context.episode.id} context={context} />
          </div>
        ) : drawerStage === 'platform' && epId ? (
          <SlicePreview episodeId={epId} preset={draft.preset} revision={episode.data?.revision} />
        ) : !native && epId && episode.data ? (
          <div className="room-canvas room-template" id="reader-canvas">
            <TemplatePreview
              episodeId={epId}
              templateId={look}
              lettered={savedLayout}
              draft={draft}
              revision={episode.data?.revision}
            />
          </div>
        ) : (
          <div
            className={`room-canvas ${staged ? 'mio-stage-root mio-stage-scroll' : ''}`}
            id="reader-canvas"
            ref={setScroller}
            data-reading-mode={stage}
            style={staged ? ({ '--mio-stage-height': `${view.h}px` } as CSSProperties) : undefined}
          >
            <div className={`room-scroll ${staged ? 'mio-stage-pages' : ''}`}>
              {episode.isLoading || series.isLoading || (pages.length > 0 && reading.isPending) ? (
                <p className="room-empty">{t('reader.loading')}</p>
              ) : reading.error ? null : savedLayout &&
                stage === 'continuous' &&
                reading.data &&
                epId &&
                pages.length ? (
                <div
                  className="reader-saved-strip"
                  style={{
                    maxWidth: reading.data.width,
                    aspectRatio: `${reading.data.width} / ${Math.max(1, reading.data.height)}`,
                  }}
                >
                  <img
                    key={reading.data.revision}
                    src={readingStripUrl(epId, reading.data.revision)}
                    alt={t('reader.savedStrip')}
                    width={reading.data.width}
                    height={reading.data.height}
                  />
                  {pages.map((p, i) => {
                    const top = reading.data.panel_boxes[p.id]?.[1] ?? 0;
                    return (
                      <span
                        key={p.id}
                        data-page-anchor={i}
                        className="reader-strip-anchor"
                        aria-hidden="true"
                        style={{ top: `${(100 * top) / Math.max(1, reading.data.height)}%` }}
                      />
                    );
                  })}
                </div>
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
                        '--mio-stage-backdrop': `url("${pages[stage.start].src}")`,
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
              {savedLayout &&
              stage === 'continuous' &&
              captions &&
              pages.some((p) => p.displayCaption) ? (
                <div className="reader-strip-captions">
                  {pages
                    .filter((p) => p.displayCaption)
                    .map((p) => (
                      <div className="scroll-caption" key={p.id}>
                        <p>{p.displayCaption}</p>
                      </div>
                    ))}
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
            <h3>{t('reader.pageN', { n: current + 1 })}</h3>
            <p>{cur.caption || t('reader.noCaption')}</p>
          </aside>
        ) : null}
      </section>
      <div
        className="room-filmstrip"
        id="room-filmstrip"
        hidden={!(film || layout === 'gallery') || !nativeStage}
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
            {reading.data && epId ? (
              <img
                src={readingPanelUrl(epId, p.id, reading.data.revision, 256)}
                alt=""
                loading="lazy"
              />
            ) : null}
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
      {nativeStage ? (
        <footer className="room-footer">
          {nativeStage ? (
            <>
              <span className="native-reading-controls" hidden={layout !== 'webtoon'}>
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
          <span className="room-scene-title" aria-hidden="true" />
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
      ) : null}
      <PresentationDrawer
        open={panel === 'export'}
        onClose={() => navigate(`${base}${keep}`)}
        templates={list}
        infos={templates.data ?? []}
        look={look}
        native={NATIVE}
        onLook={setLookSaved}
        draft={draft}
        onDraft={setDraft}
        layout={layout}
        onLayout={setLayoutSaved}
        episodeId={episode.data?.id}
        seriesId={seriesId}
        episodes={items}
        title={series.data?.title ?? ''}
        lettered={savedLayout}
        onPlatform={setPlatformOpen}
      />
    </dialog>
  );
}
