import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { raw } from '../../api/client';
import { Icon } from '../../app/icons';
import { albumBody, type ExportDraft } from './presentation';

export function ExportPreviewDialog(props: {
  open: boolean;
  onClose: () => void;
  episodeId: string | undefined;
  templateId: string;
  lettered: boolean;
  draft: ExportDraft;
  title: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const body = props.episodeId
    ? {
        ...albumBody(
          { episodeId: props.episodeId, templateId: props.templateId, lettered: props.lettered },
          props.draft,
        ),
        image_profile: 'preview',
        max_width: 1600,
      }
    : null;
  const preview = useQuery({
    queryKey: ['album-export-trial', body],
    enabled: props.open && !!body,
    retry: false,
    staleTime: 0,
    queryFn: async () =>
      (
        await raw('/api/export/album', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).text(),
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!props.open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [props.open]);

  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else dialog?.removeAttribute('open');
    props.onClose();
  };
  const status = preview.error
    ? t('reader.templatePreview.failed', { message: (preview.error as Error).message })
    : !body
      ? t('reader.templatePreview.empty')
      : !preview.data
        ? t('reader.templatePreview.loading')
        : preview.isFetching
          ? t('reader.templatePreview.updating')
          : '';

  return (
    <dialog
      ref={ref}
      className="album-preview-dialog"
      aria-labelledby="album-preview-title"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        close();
      }}
    >
      <header className="album-preview-head">
        <div>
          <p className="eyebrow">{t('reader.templatePreview.eyebrow')}</p>
          <h2 id="album-preview-title">{props.title}</h2>
        </div>
        <button
          type="button"
          className="ibtn"
          aria-label={t('reader.templatePreview.close')}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="album-preview-body">
        {status ? (
          <p className="album-preview-status" role={preview.error ? 'alert' : 'status'}>
            {status}
          </p>
        ) : null}
        {preview.data ? (
          <iframe
            className="album-preview-frame"
            title={t('reader.templatePreview.frameTitle')}
            sandbox="allow-scripts allow-popups"
            srcDoc={preview.data}
          />
        ) : null}
      </div>
    </dialog>
  );
}
