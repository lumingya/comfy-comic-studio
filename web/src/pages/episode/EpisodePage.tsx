import {
  BookOpenText,
  ChevronLeft,
  Download,
  Image,
  LayoutPanelTop,
  ScrollText,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useEpisode, usePatchEpisode, useSeries } from '../../api/series';
import type { Episode, Series } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toastError } from '../../components/toast';
import { Loading } from '../../components/ui';

export interface EpisodeContext {
  episode: Episode;
  series: Series;
}

export function useEpisodeContext() {
  return useOutletContext<EpisodeContext>();
}

export default function EpisodePage() {
  const { t } = useTranslation();
  const { episodeId } = useParams();
  const episode = useEpisode(episodeId);
  const series = useSeries(episode.data?.series_id);
  const patch = usePatchEpisode(episodeId ?? '');
  const [title, setTitle] = useState('');

  useEffect(() => setTitle(episode.data?.title ?? ''), [episode.data?.title]);

  if (episode.isLoading || series.isLoading) return <Loading />;
  if (episode.error || !episode.data || !series.data)
    return (
      <div className="page">
        <QueryError error={episode.error ?? series.error} />
      </div>
    );

  const ep = episode.data;
  const tab = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? 'active' : ''}`;
  const saveTitle = () =>
    title.trim() && title !== ep.title && patch.mutate({ title }, { onError: toastError });

  return (
    <div className="page wide">
      <header className="workspace-head">
        <Link to={`/series/${ep.series_id}/episodes`} className="back-link">
          <ChevronLeft size={14} /> {series.data.title}
        </Link>
        <input
          className="input bare workspace-title"
          value={title}
          aria-label={t('common.title')}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <nav className="workspace-tabs">
          <NavLink to="script" className={tab}>
            <ScrollText size={14} /> {t('episode.script')}
          </NavLink>
          <NavLink to="board" className={tab}>
            <Image size={14} /> {t('episode.board')}
          </NavLink>
          <NavLink to="canvas" className={tab}>
            <LayoutPanelTop size={14} /> {t('episode.canvas')}
          </NavLink>
          <NavLink to="read" className={tab}>
            <BookOpenText size={14} /> {t('episode.read')}
          </NavLink>
          <NavLink to="export" className={tab}>
            <Download size={14} /> {t('episode.export')}
          </NavLink>
        </nav>
      </header>
      <div className="workspace-body">
        <Outlet context={{ episode: ep, series: series.data } satisfies EpisodeContext} />
      </div>
    </div>
  );
}
