import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getOrganizableEpisode,
  refreshOrganizedWork,
  transferPanels,
  useOrganizableEpisodes,
} from '../../api/longform';
import type { Episode } from '../../api/types';
import { QueryError } from '../../app/errors';
import { flushEditors } from '../../app/useAutoDraft';
import { toast } from '../../components/toast';
import { Field, Loading, Modal, Select } from '../../components/ui';

export function TransferDialog({
  episode,
  panelIds,
  onClose,
  onDone,
}: {
  episode: Episode;
  panelIds: string[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const choices = useOrganizableEpisodes(episode.series_id);
  const [source, setSource] = useState(episode);
  const [targetId, setTargetId] = useState('');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [includeLocked, setIncludeLocked] = useState(false);
  const [breakBridges, setBreakBridges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const target = useQuery({
    queryKey: ['longform-target', targetId],
    queryFn: () => getOrganizableEpisode(targetId),
    enabled: !!targetId,
    refetchOnWindowFocus: false,
  });
  const candidates = choices.data?.filter((ep) => ep.id !== source.id) ?? [];
  const submit = async () => {
    if (!target.data || busy) return;
    setBusy(true);
    setError(null);
    try {
      await flushEditors();
      const result = await transferPanels(source.series_id, {
        source_episode_id: source.id,
        target_episode_id: target.data.id,
        source_revision: source.revision,
        target_revision: target.data.revision,
        panel_ids: panelIds,
        mode,
        include_locked: includeLocked,
        break_bridges: breakBridges,
      });
      await refreshOrganizedWork(qc, source.series_id, [result.source, result.target]);
      toast(t('longform.transferred', { count: panelIds.length, title: result.target.title }));
      onDone?.();
      onClose();
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await flushEditors();
      setSource(await getOrganizableEpisode(source.id));
      if (targetId) await target.refetch({ throwOnError: true });
      await choices.refetch({ throwOnError: true });
      setError(null);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t('longform.transferTitle', { count: panelIds.length })}
      description={t('longform.transferHint')}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={
              busy || !target.data || target.isFetching || !!target.error || !!choices.error
            }
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : null}
            {t(`longform.${mode}`)}
          </button>
        </>
      }
    >
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        {choices.isLoading ? <Loading /> : null}
        {choices.error ? <QueryError error={choices.error} onRetry={choices.refetch} /> : null}
        {!choices.isLoading && !choices.error && !candidates.length ? (
          <p className="muted">{t('longform.noTarget')}</p>
        ) : null}
        <Field label={t('longform.destination')}>
          <Select
            value={targetId}
            onChange={(id) => {
              setTargetId(id);
              setError(null);
            }}
            options={[
              { value: '', label: t('longform.choose') },
              ...candidates.map((ep) => ({ value: ep.id, label: ep.title })),
            ]}
          />
        </Field>
        {target.isFetching ? <Loading /> : null}
        {target.error ? <QueryError error={target.error} onRetry={target.refetch} /> : null}
        <Field label={t('longform.action')}>
          <Select
            value={mode}
            onChange={setMode}
            options={[
              { value: 'copy', label: t('longform.copy') },
              { value: 'move', label: t('longform.move') },
            ]}
          />
        </Field>
        {mode === 'move' ? <p className="small muted">{t('longform.moveHint')}</p> : null}
        <details>
          <summary>{t('longform.options')}</summary>
          <label className="row" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={includeLocked}
              onChange={(e) => setIncludeLocked(e.target.checked)}
            />
            {t('longform.includeLocked')}
          </label>
          <label className="row" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={breakBridges}
              onChange={(e) => setBreakBridges(e.target.checked)}
            />
            {t('longform.breakBridges')}
          </label>
        </details>
      </fieldset>
      {error ? (
        <div role="alert" style={{ marginTop: 16 }}>
          <p>{error.message}</p>
          <button className="btn" disabled={busy} onClick={() => void refresh()}>
            {t('longform.refresh')}
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
