import { Icon } from '../../app/icons';
import type { ReaderState } from './readerController';

export function ReaderHeader({ reader }: { reader: ReaderState & { panel: string } }) {
  const {
    t,
    close,
    series,
    items,
    epId,
    setPage,
    params,
    setParams,
    fullscreen,
    toggleFullscreen,
    panel,
    togglePanel,
  } = reader;
  return (
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
      <span className="room-title grow" id="reader-panel-label">
        {series.data?.title ?? t('classic.shelf.reading', { defaultValue: 'Mio' })}
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
        aria-expanded={panel === 'export'}
        aria-controls="presentation-drawer"
        onClick={() => togglePanel('export')}
      >
        <Icon name="download" sm />
        {t('reader.export')}
      </button>
      <button
        type="button"
        className="btn small"
        aria-pressed={panel === 'layout'}
        onClick={() => togglePanel('layout')}
      >
        <Icon name="grid" sm />
        {t('reader.layout')}
      </button>
    </header>
  );
}
