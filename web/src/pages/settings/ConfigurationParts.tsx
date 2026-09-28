import { ChevronDown } from 'lucide-react';
import { useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { UNSAFE_DataRouterContext } from 'react-router-dom';
import { useUnsavedGuard } from '../../app/autosave';
import { confirm } from '../../components/confirm';

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
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className="config-advanced">
      <summary>
        <span className="grow">
          <strong>{title}</strong>
          {hint ? <small>{hint}</small> : null}
        </span>
        <ChevronDown size={16} aria-hidden />
      </summary>
      <div className="config-advanced-body">{children}</div>
    </details>
  );
}

export function ConfigurationSaveBar({
  dirty,
  pending,
  invalid = false,
  onCancel,
}: {
  dirty: boolean;
  pending: boolean;
  invalid?: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="config-save-bar" role="status">
      <span className={`grow small ${dirty ? 'warn-text' : 'muted'}`}>
        {pending ? t('config.saving') : dirty ? t('config.unsaved') : t('common.saved')}
      </span>
      {dirty ? (
        <button type="button" className="btn ghost" disabled={pending} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      ) : null}
      <button type="submit" className="btn primary" disabled={!dirty || pending || invalid}>
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
