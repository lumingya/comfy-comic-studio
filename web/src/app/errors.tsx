import { Compass, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Empty } from '../components/ui';

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  return error instanceof Error ? error.message : String(error ?? '');
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <Empty
        icon={<Compass size={24} />}
        title={t('common.notFoundTitle')}
        action={
          <Link className="btn primary" to="/">
            {t('common.backToWorks')}
          </Link>
        }
      >
        {t('common.notFoundBody')}
      </Empty>
    </div>
  );
}

export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  return (
    <div className="page">
      <Empty
        title={t('common.error')}
        action={
          <>
            <button className="btn" onClick={() => window.location.reload()}>
              <RotateCw size={14} /> {t('common.reload')}
            </button>
            <Link className="btn primary" to="/">
              {t('common.backToWorks')}
            </Link>
          </>
        }
      >
        <span className="mono small">{describe(error)}</span>
      </Empty>
    </div>
  );
}

/** Inline error for a failed query, with a retry when the caller can refetch. */
export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => unknown }) {
  const { t } = useTranslation();
  return (
    <div className="notice error query-error" role="alert">
      <span className="grow">{t('common.errorWith', { message: describe(error) })}</span>
      {onRetry ? (
        <button className="btn sm" onClick={() => void onRetry()}>
          <RotateCw size={13} /> {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}
