import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  importAlbumHtml,
  MAX_ALBUM_HTML_BYTES,
  type AlbumHtmlImportResult,
} from '../../api/albumImport';
import { Icon } from '../../app/icons';
import { Modal } from '../../components/ui';

/** Reading albums are separate from template HTML and editable .mio.zip source bundles. */
export function AlbumHtmlImport({ onDialogChange }: { onDialogChange?: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AlbumHtmlImportResult | null>(null);
  useEffect(
    () => () => {
      const controller = request.current;
      request.current = null;
      controller?.abort();
    },
    [],
  );
  const changeOpen = (value: boolean) => {
    if (!value) {
      request.current?.abort();
      request.current = null;
      setBusy(false);
    }
    setFile(null);
    setResult(null);
    setError('');
    setOpen(value);
    onDialogChange?.(value);
  };
  const choose = (value: File) => {
    setResult(null);
    setFile(null);
    if (!/\.html?$/i.test(value.name)) setError(t('albumImport.wrongType'));
    else if (value.size > MAX_ALBUM_HTML_BYTES) setError(t('albumImport.tooLarge'));
    else {
      setFile(value);
      setError('');
    }
  };
  const submit = async () => {
    // The ref closes the same-tick double-click window before React disables the button.
    if (!file || request.current || result) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const report = await importAlbumHtml(file, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      setResult(report);
      void qc.invalidateQueries({ queryKey: ['series'] });
      void qc.invalidateQueries({ queryKey: ['episodes'] });
      void qc.invalidateQueries({ queryKey: ['collections'] });
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <>
      <button type="button" className="btn" onClick={() => changeOpen(true)}>
        <Icon name="upload" />
        {t('albumImport.action')}
      </button>
      <Modal
        open={open}
        onOpenChange={changeOpen}
        title={t('albumImport.title')}
        description={t('albumImport.hint')}
        footer={
          <>
            <button type="button" className="btn" onClick={() => changeOpen(false)}>
              {t(result ? 'common.close' : 'common.cancel')}
            </button>
            {result ? (
              result.series_ids[0] ? (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const id = result.series_ids[0];
                    changeOpen(false);
                    navigate(`/gallery/${encodeURIComponent(id)}?collection=unfiled`);
                  }}
                >
                  {t('albumImport.openFirst')}
                </button>
              ) : null
            ) : (
              <button
                type="button"
                className="btn primary"
                disabled={!file || busy}
                onClick={() => void submit()}
              >
                {t(busy ? 'albumImport.importing' : 'albumImport.confirm')}
              </button>
            )}
          </>
        }
      >
        {result ? (
          <>
            <p role="status">
              {t('albumImport.summary', {
                books: result.imported_books,
                frames: result.imported_frames,
                assets: result.imported_assets,
              })}
            </p>
            <p className="help">
              {t(result.source_data_used ? 'albumImport.sourceUsed' : 'albumImport.readingOnly')}
            </p>
            {result.warnings.length ? (
              <section aria-label={t('albumImport.warnings')}>
                <strong>{t('albumImport.warnings')}</strong>
                <ul>
                  {result.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {t('albumImport.chooseFile')}
            </button>
            <input
              type="file"
              hidden
              ref={input}
              accept=".html,.htm"
              aria-label={t('albumImport.file')}
              disabled={busy}
              onChange={(event) => {
                const value = event.target.files?.[0];
                event.target.value = '';
                if (value) choose(value);
              }}
            />
            {file ? <p className="small muted">{file.name}</p> : null}
            {error ? (
              <p className="notice error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </Modal>
    </>
  );
}
