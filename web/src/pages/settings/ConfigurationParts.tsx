import { ChevronDown } from 'lucide-react';
import { useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useUnsavedGuard } from '../../app/autosave';
import { confirm } from '../../components/confirm';
import { TextInput } from '../../components/ui';

/** A saved key is a server sentinel, never editable password text. */
export function SecretInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const saved = value === '••••••';
  return (
    <span className="config-secret">
      <TextInput
        mono
        type="password"
        autoComplete="new-password"
        value={saved ? '' : value}
        placeholder={saved ? t('config.secret.saved') : ''}
        onChange={onChange}
      />
      {value ? (
        <button type="button" className="btn ghost sm" onClick={() => onChange('')}>
          {t('config.secret.clear')}
        </button>
      ) : null}
    </span>
  );
}

/** The app uses a data router; isolated section previews may only have a MemoryRouter. */
export function ConfigurationGuard({ dirty }: { dirty: boolean }) {
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <RouteGuard dirty={dirty} /> : null;
}

function RouteGuard({ dirty }: { dirty: boolean }) {
  useUnsavedGuard(dirty, true);
  return null;
}

export function Advanced({
  title,
  hint,
  children,
  lazy = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode | (() => ReactNode);
  lazy?: boolean;
}) {
  const [visited, setVisited] = useState(!lazy);
  return (
    <details
      className="config-advanced"
      onToggle={(event) => {
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>
        <span className="grow">
          <strong>{title}</strong>
          {hint ? <small>{hint}</small> : null}
        </span>
        <ChevronDown size={16} aria-hidden />
      </summary>
      {visited ? (
        <div className="config-advanced-body">
          {typeof children === 'function' ? children() : children}
        </div>
      ) : null}
    </details>
  );
}

export function ConfigurationSaveBar({
  dirty,
  pending,
  busy = false,
  invalid = false,
  onCancel,
}: {
  dirty: boolean;
  pending: boolean;
  busy?: boolean;
  invalid?: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!dirty && !pending) return null;
  return (
    <div className="config-save-bar" role="status">
      <span className={`grow small ${dirty ? 'warn-text' : 'muted'}`}>
        {pending ? t('config.saving') : t('config.unsaved')}
      </span>
      {dirty ? (
        <button type="button" className="btn ghost" disabled={pending || busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      ) : null}
      <button type="submit" className="btn primary" disabled={!dirty || pending || busy || invalid}>
        {t('common.save')}
      </button>
    </div>
  );
}

export function useDiscardChanges() {
  const { t } = useTranslation();
  return (dirty: boolean) =>
    !dirty ||
    confirm({
      title: t('common.unsavedTitle'),
      description: t('common.unsavedBody'),
      confirmLabel: t('common.leave'),
      danger: true,
    });
}

export function validHttpUrl(value: string, optional = false): boolean {
  if (!value.trim()) return optional;
  try {
    const url = new URL(value.trim());
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON must be an object');
  }
  return value as Record<string, unknown>;
}

export function saveJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
