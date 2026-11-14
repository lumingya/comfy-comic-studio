import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  applyVariable,
  findVariable,
  previewVariable,
  refreshOrganizedWork,
  useOrganizableEpisodes,
  type VariableCommand,
  type VariablePreview,
  type VariableSearch,
} from '../../api/longform';
import { flushEditors } from '../../app/useAutoDraft';
import { toast } from '../../components/toast';
import { Field, Modal, Select, TextArea, TextInput } from '../../components/ui';

const validKey = (key: string) => /^[^\s{}]{1,64}$/u.test(key);

export function VariableToolsDialog({
  seriesId,
  onClose,
}: {
  seriesId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const episodes = useOrganizableEpisodes(seriesId);
  const [key, setKey] = useState('');
  const [action, setAction] = useState<VariableCommand['action']>('rename');
  const [value, setValue] = useState('');
  const [includeLocked, setIncludeLocked] = useState(false);
  const [found, setFound] = useState<VariableSearch | null>(null);
  const [preview, setPreview] = useState<VariablePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const command: VariableCommand = { key, action, value, include_locked: includeLocked };
  const run = async (step: 'find' | 'preview' | 'apply') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await flushEditors();
      if (step === 'find') {
        setPreview(null);
        setFound(await findVariable(seriesId, key));
      } else if (step === 'preview') {
        setPreview(await previewVariable(seriesId, command));
      } else if (preview && !preview.conflicts.length) {
        const result = await applyVariable(seriesId, { ...command, expected_head: preview.head });
        await refreshOrganizedWork(qc, seriesId, result.episodes, result.series);
        toast(t('longform.applied', { count: result.changes.length }));
        onClose();
      }
    } catch (cause) {
      setError(cause as Error);
      if (step !== 'find') setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const location = (owner: string, path: string) => {
    const title =
      owner === seriesId
        ? t('longform.work')
        : (episodes.data?.find((ep) => ep.id === owner)?.title ?? t('longform.episode'));
    const field = path
      .slice(1)
      .split('/')
      .map((part) => {
        const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
        return /^\d+$/.test(decoded)
          ? String(Number(decoded) + 1)
          : t(`longform.fields.${decoded}`, { defaultValue: decoded });
      })
      .join(' · ');
    return `${title} — ${field}`;
  };
  const canPreview =
    !!found?.occurrences.length && (action === 'replace' || (validKey(value) && value !== key));
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={t('longform.variablesTitle')}
      description={t('longform.variablesHint')}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          {preview ? (
            <button
              className="btn primary"
              disabled={busy || !!preview.conflicts.length || !preview.changes.length}
              onClick={() => void run('apply')}
            >
              {t('longform.apply', { count: preview.changes.length })}
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy || !canPreview}
              onClick={() => void run('preview')}
            >
              {t('longform.preview')}
            </button>
          )}
        </>
      }
    >
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <div className="row" style={{ alignItems: 'end' }}>
          <div className="grow">
            <Field label={t('longform.key')} hint={t('longform.keyHint')}>
              <TextInput
                aria-label={t('longform.key')}
                autoFocus
                value={key}
                maxLength={64}
                onChange={(next) => {
                  setKey(next);
                  setFound(null);
                  setPreview(null);
                  setError(null);
                }}
              />
            </Field>
          </div>
          <button className="btn" disabled={!validKey(key)} onClick={() => void run('find')}>
            {t('longform.find')}
          </button>
        </div>
        {found ? (
          <>
            <p className="small muted">
              {t(found.occurrences.length ? 'longform.found' : 'longform.notFound', {
                count: found.occurrences.length,
              })}
            </p>
            <Field label={t('longform.action')}>
              <Select
                value={action}
                onChange={(next) => {
                  setAction(next);
                  setPreview(null);
                }}
                options={[
                  { value: 'rename', label: t('longform.rename') },
                  { value: 'replace', label: t('longform.replace') },
                ]}
              />
            </Field>
            <Field
              label={t(action === 'rename' ? 'longform.newKey' : 'longform.replacement')}
              hint={action === 'replace' ? t('longform.replaceHint') : undefined}
            >
              {action === 'rename' ? (
                <TextInput
                  value={value}
                  maxLength={64}
                  onChange={(next) => {
                    setValue(next);
                    setPreview(null);
                  }}
                />
              ) : (
                <TextArea
                  aria-label={t('longform.replacement')}
                  rows={3}
                  value={value}
                  onChange={(next) => {
                    setValue(next);
                    setPreview(null);
                  }}
                />
              )}
            </Field>
            <details>
              <summary>{t('longform.options')}</summary>
              <label className="row" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={includeLocked}
                  onChange={(event) => {
                    setIncludeLocked(event.target.checked);
                    setPreview(null);
                  }}
                />
                {t('longform.includeLocked')}
              </label>
            </details>
          </>
        ) : null}
      </fieldset>
      {busy ? (
        <p role="status" className="small muted">
          {t('common.loading')}
        </p>
      ) : null}
      {error ? <p role="alert">{error.message}</p> : null}
      {preview?.conflicts.length ? (
        <div role="alert">
          <strong>{t('longform.blocked')}</strong>
          <ul>
            {preview.conflicts.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview ? (
        <section style={{ marginTop: 20 }} aria-label={t('longform.preview')}>
          <p className="small muted">
            {t(preview.changes.length ? 'longform.changes' : 'longform.noChanges', {
              count: preview.changes.length,
            })}
          </p>
          {preview.changes.map((change, index) => (
            <article
              key={index}
              style={{ padding: '14px 0', borderTop: '1px solid var(--border)' }}
            >
              <strong className="small">
                {location(change.owner_id, change.path)}
                {change.locked ? ` · ${t('longform.locked')}` : ''}
              </strong>
              <p className="small muted">{t('longform.before')}</p>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {change.before || t('longform.empty')}
              </div>
              <p className="small muted">{t('longform.after')}</p>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {change.after || t('longform.empty')}
              </div>
            </article>
          ))}
        </section>
      ) : found ? (
        <ul style={{ paddingLeft: 20, marginTop: 20 }}>
          {found.occurrences.map((item, index) => (
            <li key={index} style={{ marginBottom: 12 }}>
              <span className="small muted">
                {location(item.owner_id, item.path)}
                {item.locked ? ` · ${t('longform.locked')}` : ''}
              </span>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.value}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <details style={{ marginTop: 20 }}>
        <summary>{t('longform.scope')}</summary>
        <p className="small muted">{t('longform.scopeText')}</p>
      </details>
    </Modal>
  );
}
