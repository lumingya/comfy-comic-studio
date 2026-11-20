import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../app/icons';
import { ownCancel } from '../../components/topLayer';

export function TemplateStudioPreview(props: {
  html: string | undefined;
  title: string;
  episodeId: string | undefined;
}) {
  const { t } = useTranslation();
  const fullPreviewRef = useRef<HTMLDialogElement>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [fullPreview, setFullPreview] = useState(false);
  useEffect(() => {
    const d = fullPreviewRef.current;
    if (!d) return;
    if (fullPreview && props.html && !d.open) {
      if (d.showModal) d.showModal();
      else d.setAttribute('open', '');
    }
    if (!fullPreview && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [fullPreview, props.html]);
  return (
    <>
      <section className="template-preview-pane">
        <div className="preview-toolbar">
          <i className="dot" style={{ width: 4, height: 4 }} />
          <span>{t('reader.studio.livePreview')}</span>
          <span className="spacer" />
          <button
            type="button"
            className="ibtn"
            title={t('reader.studio.readFullscreen')}
            aria-label={t('reader.studio.readFullscreen')}
            disabled={!props.html}
            onClick={() => setFullPreview(true)}
          >
            <Icon name="expand" sm />
          </button>
          {(['desktop', 'mobile'] as const).map((x) => (
            <button
              key={x}
              type="button"
              className={`ibtn ${device === x ? 'on' : ''}`}
              aria-pressed={device === x}
              title={t(`reader.studio.device.${x}`)}
              aria-label={t(`reader.studio.device.${x}`)}
              onClick={() => setDevice(x)}
            >
              <Icon name={x === 'desktop' ? 'expand' : 'image'} sm />
            </button>
          ))}
        </div>
        <div className={`preview-viewport ${device === 'mobile' ? 'mobile' : ''}`}>
          {props.html ? (
            <iframe
              id="template-preview"
              className="template-frame"
              title={t('reader.studio.livePreview')}
              sandbox="allow-scripts allow-popups"
              srcDoc={props.html}
            />
          ) : (
            <p className="help">
              {props.episodeId ? t('reader.previewing') : t('reader.studio.noEpisode')}
            </p>
          )}
        </div>
      </section>
      <dialog
        ref={fullPreviewRef}
        className="album-preview-dialog"
        aria-labelledby="template-full-preview-title"
        onCancel={(event) => {
          if (!ownCancel(event)) return;
          event.preventDefault();
          setFullPreview(false);
        }}
      >
        <header className="album-preview-head">
          <div>
            <p className="eyebrow">{t('reader.studio.livePreview')}</p>
            <h2 id="template-full-preview-title">{props.title}</h2>
          </div>
          <button
            type="button"
            className="ibtn"
            aria-label={t('reader.studio.closePreview')}
            onClick={() => setFullPreview(false)}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="album-preview-body">
          {props.html ? (
            <iframe
              className="album-preview-frame"
              title={t('reader.studio.previewTitle')}
              sandbox="allow-scripts allow-popups"
              srcDoc={props.html}
            />
          ) : (
            <p className="album-preview-status" role="status">
              {t('reader.studio.loading')}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
