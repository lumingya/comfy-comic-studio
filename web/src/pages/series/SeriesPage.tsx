import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { usePatchSeries, useSeries } from '../../api/series';
import type { Series } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toastError } from '../../components/toast';
import { Loading, Select } from '../../components/ui';

export function useSeriesContext() {
  return useOutletContext<{ series: Series }>();
}

const STATUSES = ['draft', 'active', 'archived'] as const;

export default function SeriesPage() {
  const { t } = useTranslation();
  const { seriesId } = useParams();
  const query = useSeries(seriesId);
  const patch = usePatchSeries(seriesId ?? '');
  const [title, setTitle] = useState('');

  useEffect(() => setTitle(query.data?.title ?? ''), [query.data?.title]);

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data)
    return (
      <div className="page">
        <QueryError error={query.error} />
      </div>
    );
  const series = query.data;
  const tab = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? 'active' : ''}`;
  const saveTitle = () => {
    if (title.trim() && title !== series.title) patch.mutate({ title }, { onError: toastError });
  };

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <ChevronLeft size={14} /> {t('nav.works')}
      </Link>
      <header className="page-head" style={{ marginBottom: 18 }}>
        <div className="grow">
          <input
            className="input title"
            value={title}
            aria-label={t('common.title')}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <Select
          style={{ width: 130 }}
          value={series.status ?? 'draft'}
          onChange={(status) => patch.mutate({ status }, { onError: toastError })}
          options={STATUSES.map((s) => ({ value: s, label: t(`series.status.${s}`) }))}
        />
      </header>
      <nav className="tabs-list">
        <NavLink to="episodes" className={tab}>
          {t('series.episodes')}
        </NavLink>
        <NavLink to="bible" className={tab}>
          {t('series.bible')}
        </NavLink>
        <NavLink to="variants" className={tab}>
          {t('series.variants')}
        </NavLink>
      </nav>
      <Outlet context={{ series }} />
    </div>
  );
}
