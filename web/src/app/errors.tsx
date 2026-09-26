import { useTranslation } from 'react-i18next';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="empty">
        <div style={{ font: '500 40px var(--serif)' }}>404</div>
        <Link to="/">{t('nav.works')}</Link>
      </div>
    </div>
  );
}

export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div className="page">
      <div className="notice error">
        {t('common.error')}：{message}
      </div>
      <p>
        <Link to="/">{t('nav.works')}</Link>
      </p>
    </div>
  );
}

/** Inline error for a failed query. */
export function QueryError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return (
    <div className="notice error">
      {t('common.error')}：{error instanceof Error ? error.message : String(error)}
    </div>
  );
}
