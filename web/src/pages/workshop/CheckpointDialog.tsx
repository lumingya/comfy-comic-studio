import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  previewCheckpoint,
  useCheckpoints,
  useCreateCheckpoint,
  useDeleteCheckpoint,
  useRestoreCheckpoint,
  type CheckpointPreview,
} from '../../api/checkpoints';
import { ApiError } from '../../api/client';
import { QueryError } from '../../app/errors';
import { flushEditors } from '../../app/useAutoDraft';
import { Field, Loading, Modal, Select, TextInput } from '../../components/ui';
import './checkpoints.css';

interface Props {
  seriesId: string;
  title?: string;
  onClose: () => void;
}

/** Works, workshop libraries and imported kits share the same checkpoint contract. */
export function CheckpointDialog(props: Props) {
  return <CheckpointForm key={props.seriesId} {...props} />;
}

function RestorePreview({ preview }: { preview: CheckpointPreview }) {
  const { t } = useTranslation();
  const groups = [
    { key: 'added', ids: preview.added_episode_ids },
    { key: 'changed', ids: preview.changed_episode_ids },
    { key: 'removed', ids: preview.removed_episode_ids },
  ];
  const noChanges = !preview.series_changed && groups.every((group) => !group.ids.length);
  return (
    <section className="checkpoint-preview" aria-label={t('recovery.previewTitle')}>
      <h3>{t('recovery.previewTitle')}</h3>
      <p>{t(preview.series_changed ? 'recovery.seriesChanged' : 'recovery.seriesUnchanged')}</p>
      <dl className="checkpoint-counts">
        {groups.map((group) => (
          <div key={group.key}>
            <dt>{t(`recovery.${group.key}`)}</dt>
            <dd>{group.ids.length}</dd>
          </div>
        ))}
      </dl>
      {noChanges ? <p className="small muted">{t('recovery.noChanges')}</p> : null}
      {preview.active_job_ids.length ? (
        <p className="notice warn">
          {t('recovery.activeJobs', { count: preview.active_job_ids.length })}
        </p>
      ) : null}
      {preview.missing_asset_ids.length ? (
        <p className="notice error">
          {t('recovery.missingAssets', { count: preview.missing_asset_ids.length })}
        </p>
      ) : null}
      {preview.reference_errors.length ? (
        <p className="notice error">
          {t('recovery.referenceErrors', { count: preview.reference_errors.length })}
        </p>
      ) : null}
      {!preview.can_restore &&
      !preview.active_job_ids.length &&
      !preview.missing_asset_ids.length &&
      !preview.reference_errors.length ? (
        <p className="notice warn">{t('recovery.blocked')}</p>
      ) : null}
      {groups.some((group) => group.ids.length) ||
      preview.active_job_ids.length ||
      preview.missing_asset_ids.length ||
      preview.reference_errors.length ? (
        <details>
          <summary>{t('recovery.details')}</summary>
          <dl className="checkpoint-details">
            {groups
              .filter((group) => group.ids.length)
              .map((group) => (
                <div key={group.key}>
                  <dt>{t(`recovery.${group.key}`)}</dt>
                  <dd>{group.ids.join(', ')}</dd>
                </div>
              ))}
            {preview.missing_asset_ids.length ? (
              <div>
                <dt>{t('recovery.missingAssets', { count: preview.missing_asset_ids.length })}</dt>
                <dd>{preview.missing_asset_ids.join(', ')}</dd>
              </div>
            ) : null}
            {preview.active_job_ids.length ? (
              <div>
                <dt>{t('recovery.activeJobs', { count: preview.active_job_ids.length })}</dt>
                <dd>{preview.active_job_ids.join(', ')}</dd>
              </div>
            ) : null}
          </dl>
          {preview.reference_errors.length ? (
            <ul>
              {preview.reference_errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function CheckpointForm({ seriesId, title, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const list = useCheckpoints(seriesId);
  const create = useCreateCheckpoint(seriesId);
  const restore = useRestoreCheckpoint(seriesId);
  const remove = useDeleteCheckpoint(seriesId);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<CheckpointPreview | null>(null);
  const [action, setAction] = useState<'create' | 'preview' | 'restore' | 'delete' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [needsPreview, setNeedsPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const checkpoint = list.data?.find((item) => item.id === selected) ?? list.data?.[0];
  const report =
    preview?.checkpoint_id === checkpoint?.id && preview?.series_id === seriesId ? preview : null;
  const busy = action !== null;
  const canRestore =
    !!report?.can_restore &&
    !report.active_job_ids.length &&
    !report.missing_asset_ids.length &&
    !report.reference_errors.length;

  const clear = () => {
    setPreview(null);
    setError(null);
    setMessage('');
    setNeedsPreview(false);
    setDeleting(false);
  };
  const save = async () => {
    if (busy || !name.trim()) return;
    clear();
    setAction('create');
    try {
      await flushEditors();
      const saved = await create.mutateAsync(name.trim());
      setName('');
      setSelected(saved.id);
      setMessage(t('recovery.created', { name: saved.name }));
    } catch (failure) {
      setError(failure);
    } finally {
      setAction(null);
    }
  };
  const inspect = async () => {
    if (busy || !checkpoint) return;
    clear();
    setAction('preview');
    try {
      await flushEditors();
      setPreview(await previewCheckpoint(seriesId, checkpoint.id));
    } catch (failure) {
      setError(failure);
    } finally {
      setAction(null);
    }
  };
  const recover = async () => {
    if (busy || !canRestore || !report || !checkpoint) return;
    setAction('restore');
    setError(null);
    setMessage('');
    try {
      await flushEditors();
      const result = await restore.mutateAsync({
        checkpointId: checkpoint.id,
        expectedHead: report.current_head,
      });
      setPreview(null);
      setMessage(t('recovery.restored', { name: result.pre_restore_checkpoint.name }));
    } catch (failure) {
      setPreview(null);
      setNeedsPreview(true);
      setError(failure);
    } finally {
      setAction(null);
    }
  };
  const erase = async () => {
    if (busy || !checkpoint || !deleting) return;
    setAction('delete');
    setError(null);
    try {
      await remove.mutateAsync(checkpoint.id);
      clear();
      setSelected('');
      setMessage(t('recovery.removedMessage'));
    } catch (failure) {
      setError(failure);
    } finally {
      setAction(null);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title={title ? t('recovery.titleFor', { title }) : t('recovery.title')}
      description={t('recovery.intro')}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="checkpoint-form">
        <form
          className="checkpoint-create"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={t('recovery.name')}>
            <TextInput
              value={name}
              onChange={setName}
              maxLength={160}
              placeholder={t('recovery.nameHint')}
              disabled={busy}
            />
          </Field>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>
            {action === 'create' ? t('config.saving') : t('recovery.create')}
          </button>
        </form>
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <QueryError error={list.error} onRetry={list.refetch} />
        ) : !checkpoint ? (
          <p className="small muted">{t('recovery.empty')}</p>
        ) : (
          <>
            <Field label={t('recovery.saved')}>
              <Select
                value={checkpoint.id}
                disabled={busy}
                onChange={(id) => {
                  clear();
                  setSelected(id);
                }}
                options={list.data.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${new Date(item.created_at).toLocaleString(i18n.language)}`,
                }))}
              />
            </Field>
            <div className="checkpoint-meta">
              <span>
                {t(checkpoint.kind === 'pre_restore' ? 'recovery.protection' : 'recovery.manual')}
              </span>
              <span>
                {t('recovery.summary', {
                  episodes: checkpoint.episode_count,
                  assets: checkpoint.asset_count,
                })}
              </span>
              {checkpoint.deleted_episode_count ? (
                <span>
                  {t('recovery.deletedCount', { count: checkpoint.deleted_episode_count })}
                </span>
              ) : null}
            </div>
            <div className="checkpoint-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void inspect()}>
                {t('recovery.preview')}
              </button>
              <button
                type="button"
                className="btn ghost danger"
                disabled={busy}
                onClick={() => {
                  setDeleting(true);
                  setError(null);
                  setMessage('');
                }}
              >
                {t('recovery.remove')}
              </button>
            </div>
            {deleting ? (
              <div className="notice warn">
                <p>{t('recovery.removeHint')}</p>
                <div className="checkpoint-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => setDeleting(false)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => void erase()}
                  >
                    {t('recovery.confirmRemove')}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
        {action === 'preview' ? <p role="status">{t('recovery.previewing')}</p> : null}
        {report ? (
          <>
            <RestorePreview preview={report} />
            <div className="checkpoint-restore">
              <p className="small muted">{t('recovery.protectHint')}</p>
              <button
                type="button"
                className="btn primary"
                disabled={busy || deleting || !canRestore}
                onClick={() => void recover()}
              >
                {t(action === 'restore' ? 'recovery.restoring' : 'recovery.restore')}
              </button>
            </div>
          </>
        ) : null}
        {needsPreview ? (
          <p className="notice warn">
            {t(
              error instanceof ApiError && error.status === 409
                ? 'recovery.changedSincePreview'
                : 'recovery.previewAgain',
            )}
          </p>
        ) : null}
        {error ? <QueryError error={error} /> : null}
        {message ? (
          <p className="notice ok" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
