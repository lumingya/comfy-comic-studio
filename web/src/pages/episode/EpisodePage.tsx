import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Download,
  Image,
  LayoutPanelTop,
  Puzzle,
  ScrollText,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { useExtensionPanels } from '../../api/open';
import { useEpisode, useEpisodes, usePatchEpisode, useSeries } from '../../api/series';
import type { Episode, Series } from '../../api/types';
import { ApiError } from '../../api/client';
import { QueryError } from '../../app/errors';
import { useRecents } from '../../app/recents';
import { usePageTitle } from '../../app/title';
import { panelKey } from '../../components/ExtensionFrame';
import { toastError } from '../../components/toast';
import { InlineTitle, Loading, Progress } from '../../components/ui';

const TABS = ['script', 'board', 'canvas', 'read', 'export'] as const;

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
  const panels = useExtensionPanels('episode');
  // Neighbours for prev / next (first page of the series' episodes covers the common case).
  const siblings = useEpisodes(episode.data?.series_id);
  const section = useLocation().pathname.split('/')[3] as (typeof TABS)[number] | undefined;
  usePageTitle(
    section && TABS.includes(section) ? t(`episode.${section}`) : null,
    episode.data?.title,
    series.data?.title,
  );

  // Remember the visit for the rail's "Recent" list; forget episodes that no longer exist.
  const { visit, forget } = useRecents();
  const loaded = episode.data;
  const seriesTitle = series.data?.title;
  useEffect(() => {
    if (loaded && seriesTitle)
      visit({ id: loaded.id!, title: loaded.title, seriesId: loaded.series_id, seriesTitle });
    else if (episode.error instanceof ApiError && episode.error.status === 404 && episodeId)
      forget(episodeId);
  }, [loaded, seriesTitle, episode.error, episodeId, visit, forget]);

  if (episode.isLoading || series.isLoading)
    return (
      <div className="page wide">
        <Loading />
      </div>
    );
  if (episode.error || !episode.data || !series.data)
    return (
      <div className="page">
        <QueryError
          error={episode.error ?? series.error}
          onRetry={() => Promise.all([episode.refetch(), series.refetch()])}
        />
      </div>
    );

  const ep = episode.data;
  const tab = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? 'active' : ''}`;
  const order = siblings.data?.items ?? [];
  const at = order.findIndex((e) => e.id === ep.id);
  const prev = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const keepTab = section && TABS.includes(section) ? section : 'script';
  const adopted = new Set(
    ep.takes.filter((x) => x.status === 'adopted' && !x.variant_id).map((x) => x.panel_id),
  );
  const done = ep.panels.filter((p) => adopted.has(p.id!)).length;

  return (
    <div className="page wide">
      <header className="workspace-head">
        <nav className="crumbs" aria-label={t('nav.breadcrumbs')}>
          <Link to="/">{t('nav.works')}</Link>
          <ChevronRight size={13} />
          <Link to={`/series/${ep.series_id}/episodes`}>{series.data.title}</Link>
          <ChevronRight size={13} />
          <span>{t('series.episodeNo', { n: ep.order + 1 })}</span>
          {at >= 0 && order.length > 1 ? (
            <span className="workspace-nav">
              <Link
                to={prev ? `/episodes/${prev.id}/${keepTab}` : '#'}
                className="btn ghost icon sm"
                aria-disabled={!prev}
                tabIndex={prev ? 0 : -1}
                title={prev ? `${t('episode.prev')} · ${prev.title}` : t('episode.prev')}
                aria-label={t('episode.prev')}
              >
                <ChevronLeft size={15} />
              </Link>
              <span className="mono">
                {at + 1} / {order.length}
              </span>
              <Link
                to={next ? `/episodes/${next.id}/${keepTab}` : '#'}
                className="btn ghost icon sm"
                aria-disabled={!next}
                tabIndex={next ? 0 : -1}
                title={next ? `${t('episode.next')} · ${next.title}` : t('episode.next')}
                aria-label={t('episode.next')}
              >
                <ChevronRight size={15} />
              </Link>
            </span>
          ) : null}
        </nav>
        <div className="workspace-title-row">
          <InlineTitle
            className="input bare workspace-title"
            value={ep.title}
            label={t('common.title')}
            onSave={(title) => patch.mutate({ title }, { onError: toastError })}
          />
          <div className="workspace-meta">
            <span>
              {ep.panels.length
                ? t('series.adoptedOf', { done, total: ep.panels.length })
                : t('series.noPanels')}
            </span>
            {ep.panels.length ? <Progress value={done / ep.panels.length} /> : null}
          </div>
        </div>
        <nav className="tabs-list workspace-tabs">
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
          {(panels.data ?? []).map((p) => (
            <NavLink key={panelKey(p)} to={`ext/${panelKey(p)}`} className={tab}>
              <Puzzle size={14} /> {p.title}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="workspace-body">
        <Outlet context={{ episode: ep, series: series.data } satisfies EpisodeContext} />
      </div>
    </div>
  );
}
