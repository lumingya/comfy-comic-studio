import { BookText, ChevronRight, Layers, ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { usePatchSeries, useSeries } from '../../api/series';
import type { Series } from '../../api/types';
import { QueryError } from '../../app/errors';
import { usePageTitle } from '../../app/title';
import { toastError } from '../../components/toast';
import { InlineTitle, Loading, Select } from '../../components/ui';

export function useSeriesContext() {
  return useOutletContext<{ series: Series }>();
}

const STATUSES = ['draft', 'active', 'archived'] as const;

export default function SeriesPage() {
  const { t } = useTranslation();
  const { seriesId } = useParams();
  const query = useSeries(seriesId);
  const patch = usePatchSeries(seriesId ?? '');
  const section = useLocation().pathname.split('/').pop();
  const sectionTitle =
    section === 'bible' || section === 'variants' ? t(`series.${section}`) : t('series.episodes');
  usePageTitle(query.data?.title, sectionTitle);

  if (query.isLoading) return <Loading />;
  if (query.error || !query.data)
    return (
      <div className="page">
        <QueryError error={query.error} />
      </div>
    );
  const series = query.data;
  const tab = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? 'active' : ''}`;

  return (
    <div className="page">
      <nav className="crumbs" aria-label={t('nav.breadcrumbs')}>
        <Link to="/">{t('nav.works')}</Link>
        <ChevronRight size={13} />
        <span>{series.title}</span>
      </nav>
      <header className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <InlineTitle
            value={series.title}
            label={t('common.title')}
            onSave={(title) => patch.mutate({ title }, { onError: toastError })}
          />
          <InlineTitle
            className="input bare page-subtitle"
            value={series.subtitle ?? ''}
            label={t('works.subtitle')}
            placeholder={t('works.subtitlePlaceholder')}
            allowEmpty
            onSave={(subtitle) => patch.mutate({ subtitle }, { onError: toastError })}
          />
        </div>
        <Select
          style={{ width: 130 }}
          aria-label={t('series.statusLabel')}
          value={series.status ?? 'draft'}
          onChange={(status) => patch.mutate({ status }, { onError: toastError })}
          options={STATUSES.map((s) => ({ value: s, label: t(`series.status.${s}`) }))}
        />
      </header>
      <nav className="tabs-list">
        <NavLink to="episodes" className={tab}>
          <ListOrdered size={14} /> {t('series.episodes')}
        </NavLink>
        <NavLink to="bible" className={tab}>
          <BookText size={14} /> {t('series.bible')}
        </NavLink>
        <NavLink to="variants" className={tab}>
          <Layers size={14} /> {t('series.variants')}
        </NavLink>
      </nav>
      <Outlet context={{ series }} />
    </div>
  );
}
