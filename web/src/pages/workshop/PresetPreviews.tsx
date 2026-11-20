import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import {
  usePreviewPreset,
  useQueueAction,
  requireQueueAccepted,
  type GenerationOptions,
  type Preset,
} from '../../api/workshop';
import type { Series, SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import { toastError } from '../../components/toast';
import { Modal } from '../../components/ui';
import { AssemblyIntents } from './assemblyIntent';
import { GenerationSettings, generationKey } from './GenerationSettings';

/** One 独立试绘 result on the preset page: cover (or a waiting placeholder), title, delete. */
export function PreviewFigure({
  album,
  onOpen,
  onRemove,
}: {
  album: SeriesCard;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <figure className="workshop-preview-figure" role="listitem" data-preview-id={album.id}>
      <button
        type="button"
        className="workshop-preview-open"
        title={t('ws.presets.previewOpen')}
        onClick={onOpen}
      >
        {album.cover_asset_id ? (
          <img src={assetUrl(album.cover_asset_id, 320)} alt={album.title} loading="lazy" />
        ) : (
          <span className="workshop-preview-blank">{t('ws.presets.previewPending')}</span>
        )}
      </button>
      <figcaption>{album.title}</figcaption>
      <button
        type="button"
        className="ibtn"
        title={t('ws.presets.previewRemove')}
        aria-label={t('ws.presets.previewRemove')}
        onClick={onRemove}
      >
        <Icon name="trash" />
      </button>
    </figure>
  );
}

/** Legacy 「预设独立试绘」 modal: an explicitly written prompt and the
 * workflow to use; submitting adds a one-frame standby task to the assembly queue. */
export function PreviewDialog({
  kitId,
  sourceDefaults,
  preset,
  onClose,
  beforeSubmit,
  onQueued,
}: {
  kitId?: string;
  sourceDefaults?: Series['generation_defaults'];
  preset: Preset;
  onClose: () => void;
  beforeSubmit: () => Promise<unknown>;
  onQueued: (title: string) => void;
}) {
  const { t } = useTranslation();
  const queue = useQueueAction();
  const preview = usePreviewPreset(kitId);
  const [prompt, setPrompt] = useState('');
  const [generation, setGeneration] = useState<GenerationOptions>();
  const [readyToStart, setReadyToStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const created = useRef<{ key: string; series: Series } | null>(null);
  const intents = useRef(new AssemblyIntents());
  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await beforeSubmit();
      const request = {
        preset_ids: [preset.id!],
        prompt: prompt.trim(),
        generation,
      };
      const key = intents.current.keyFor('preset-preview', { ...request, preset });
      if (created.current?.key !== key) {
        const made = await preview.mutateAsync({ ...request, idempotency_key: key });
        created.current = { key, series: made.series };
      }
      const result = await queue.mutateAsync({
        action: 'start',
        ids: [created.current.series.id!],
      });
      requireQueueAccepted(result, created.current.series.id!);
      onQueued(created.current.series.title);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      id="preset-preview-dialog"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('ws.presets.previewTitle')}
      description={t('ws.presets.previewDesc')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="preset-preview-form"
            className="btn primary"
            disabled={!prompt.trim() || !generationKey(generation) || !readyToStart || busy}
          >
            <Icon name="plus" />
            {t('ws.generation.start')}
          </button>
        </>
      }
    >
      <form
        id="preset-preview-form"
        className="preset-preview-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="preset-preview-prompt">
            {t('ws.presets.previewPrompt')}
          </label>
          <textarea
            id="preset-preview-prompt"
            autoFocus
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="help">{t('ws.presets.previewPromptHelp')}</p>
        </div>
        <GenerationSettings
          id="preset-preview-generation"
          sourceDefaults={sourceDefaults}
          value={generation}
          onChange={setGeneration}
          onReadyChange={setReadyToStart}
          disabled={busy}
          onConfigure={onClose}
        />
      </form>
    </Modal>
  );
}
