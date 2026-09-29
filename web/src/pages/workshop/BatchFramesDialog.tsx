import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../app/icons';
import { Modal } from '../../components/ui';
import { DEFAULT_NAME_PATTERN, MAX_FRAMES, framesBatch, suggestBasePrompt } from './frameBatch';
import { PromptSurface, type KnownVariables, type PromptSources } from './PromptSurface';

export interface BatchFramesResult {
  frames: ReturnType<typeof framesBatch>;
  /** The template to store on the storyboard, or null to leave the stored one untouched. */
  remember: string | null;
}

/**
 * Legacy batchFramesModal: count (up to the 512-frame cap), a `{n}` name pattern and an optional
 * starting template, prefilled from the story's template or else the prompts' common beginning.
 * New frames always go to the end of the storyboard.
 */
export function BatchFramesDialog({
  existing,
  prompts,
  remembered,
  known,
  sources,
  busy,
  onClose,
  onSubmit,
}: {
  existing: number;
  prompts: string[];
  remembered: string;
  known: KnownVariables;
  sources: PromptSources;
  busy: boolean;
  onClose: () => void;
  onSubmit: (result: BatchFramesResult) => void;
}) {
  const { t } = useTranslation();
  const remaining = Math.max(0, MAX_FRAMES - existing);
  const [suggested] = useState(() => (remembered ? '' : suggestBasePrompt(prompts)));
  const [count, setCount] = useState(String(Math.min(4, remaining)));
  const [pattern, setPattern] = useState(DEFAULT_NAME_PATTERN);
  const [base, setBase] = useState(remembered || suggested);
  const [remember, setRemember] = useState(Boolean(remembered || suggested));
  const n = Number(count);
  const error = !(Number.isInteger(n) && n >= 1)
    ? t('ws.story.batch.countInvalid')
    : n > remaining
      ? t('ws.story.batch.remaining', { n: remaining })
      : '';
  const submit = () => {
    if (error || busy) return;
    onSubmit({
      frames: framesBatch({ count: n, start: existing, namePattern: pattern, basePrompt: base }),
      remember: remember ? base : null,
    });
  };
  return (
    <Modal
      id="batch-frames-dialog"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('ws.story.batch.title')}
      description={t('ws.story.batch.remaining', { n: remaining })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="batch-frames-form"
            className="btn primary"
            disabled={Boolean(error) || busy}
          >
            <Icon name="plus" />
            {t('ws.story.batch.go')}
          </button>
        </>
      }
    >
      <form
        id="batch-frames-form"
        className="batch-frames"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid2">
          <div className="field">
            <label className="label" htmlFor="batch-frames-count">
              {t('ws.story.batch.count')}
            </label>
            <input
              id="batch-frames-count"
              type="number"
              min={1}
              max={remaining}
              step={1}
              required
              autoFocus
              autoComplete="off"
              value={count}
              aria-invalid={Boolean(error)}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="batch-frames-pattern">
              {t('ws.story.batch.pattern')}
            </label>
            <input
              id="batch-frames-pattern"
              maxLength={60}
              autoComplete="off"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
        </div>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="field">
          <label className="label" htmlFor="batch-frames-base">
            {t('ws.story.batch.base')}
          </label>
          <PromptSurface
            id="batch-frames-base"
            className="workshop-base-prompt"
            value={base}
            known={known}
            sources={sources}
            placeholder={t('ws.story.baseHint')}
            onChange={setBase}
          />
          <p className="help">
            {suggested && base === suggested ? `${t('ws.story.batch.suggested')} ` : ''}
            {t('ws.story.batch.baseHelp')}
          </p>
        </div>
        <label className="row">
          <input
            id="batch-frames-remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('ws.story.batch.remember')}
        </label>
      </form>
    </Modal>
  );
}
