import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, data } from '../../api/client';
import { keys } from '../../api/keys';
import { usePatchPanel } from '../../api/series';
import type { Episode } from '../../api/types';
import { toastError } from '../../components/toast';
import { Modal } from '../../components/ui';

/** An explicit panel-local override: never edit a preset or the album's source recipe. */
export function PanelVariableFix({
  name,
  initialValue,
  episode,
  panelId,
  beforeSave,
  onClose,
}: {
  name: string;
  initialValue: string;
  episode: Episode;
  panelId: string;
  beforeSave: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const patch = usePatchPanel(episode.id!);
  const [value, setValue] = useState(initialValue);
  const [conflict, setConflict] = useState(false);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const save = async () => {
    if (saving.current || conflict || !value.trim()) return;
    saving.current = true;
    setBusy(true);
    try {
      await beforeSave();
      const latest = queryClient.getQueryData<Episode>(keys.episode(episode.id!)) ?? episode;
      const panel = latest.panels.find((item) => item.id === panelId);
      if (!panel) throw new Error(t('bibleAssist.panelMissing'));
      await patch.mutateAsync({
        panelId,
        revision: latest.revision,
        changes: {
          overrides: {
            ...panel.overrides,
            values: { ...panel.overrides.values, [`$${name}`]: value },
          },
        },
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else toastError(error);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const reload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const latest = data(
        await api.GET('/api/episodes/{episode_id}', {
          params: { path: { episode_id: episode.id! } },
        }),
      );
      const panel = latest.panels.find((item) => item.id === panelId);
      if (!panel) throw new Error(t('bibleAssist.panelMissing'));
      queryClient.setQueryData(keys.episode(episode.id!), latest);
      setCurrentValue(String(panel.overrides.values[`$${name}`] ?? ''));
      setConflict(false);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t('bibleAssist.fillTitle')}
      description={t('bibleAssist.fillScope')}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="panel-variable-fix"
            className="btn primary"
            disabled={busy || conflict || !value.trim()}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="panel-variable-fix"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="panel-variable-value">
            {t('bibleAssist.value')} <code>{`{${name}}`}</code>
          </label>
          <textarea
            id="panel-variable-value"
            autoFocus
            rows={4}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        {currentValue !== null ? (
          <p className="help">{t('bibleAssist.currentValue', { value: currentValue || '∅' })}</p>
        ) : null}
        {conflict ? (
          <div className="notice warn" role="alert">
            <p>{t('bibleAssist.conflict')}</p>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void reload()}
            >
              {t('bibleAssist.reload')}
            </button>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
