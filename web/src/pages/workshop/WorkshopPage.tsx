import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useExtensionPanels } from '../../api/open';
import {
  useAllEpisodes,
  useCreateEpisode,
  useEpisode,
  usePatchEpisode,
  useSeries,
} from '../../api/series';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { useRecents } from '../../app/recents';
import { usePageTitle } from '../../app/title';
import { panelKey } from '../../components/ExtensionFrame';
import { toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import type { EpisodeContext } from '../episode/EpisodePage';

export const TABS = ['script', 'presets', 'board', 'canvas', 'read', 'export'] as const;
export type WorkshopTab = (typeof TABS)[number];
/** The three legacy tabs; the rest are the new strip / reader / export stages. */
const PRIMARY: readonly WorkshopTab[] = ['script', 'presets', 'board'];

function Heading({ tab, actions }: { tab: WorkshopTab; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="workshop-heading">
      <div>
        <span className="context-kicker">{t('legacy.workshop.kicker')}</span>
        <h1>{t(`legacy.workshop.heads.${tab}`)}</h1>
        <p>{t(`legacy.workshop.heads.${tab}d`)}</p>
      </div>
      {actions ? (
        <div className="workshop-heading-actions" role="group">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

function Tabs({ tab, onTab }: { tab: WorkshopTab | string; onTab?: (tab: string) => void }) {
  const { t } = useTranslation();
  const panels = useExtensionPanels('episode');
  const item = (id: string, label: string) => (
    <button
      key={id}
      className={tab === id ? 'active' : ''}
      aria-current={tab === id ? 'page' : undefined}
      disabled={!onTab}
      onClick={() => onTab?.(id)}
    >
      {label}
    </button>
  );
  return (
    <nav className="quiet-tabs workshop-tabs" aria-label={t('legacy.workshop.tabsLabel')}>
      {PRIMARY.map((id) => item(id, t(`legacy.workshop.tabs.${id}`)))}
      <span className="workshop-tabs-sep" aria-hidden />
      {TABS.filter((id) => !PRIMARY.includes(id)).map((id) =>
        item(id, t(`legacy.workshop.tabs.${id}`)),
      )}
      {onTab ? (panels.data ?? []).map((p) => item(`ext/${panelKey(p)}`, p.title)) : null}
    </nav>
  );
}

/** `/workshop` — reopen the last storyboard (or the first one), keeping `?tab=`. */
export function WorkshopIndex() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { groups, isLoading } = useAllEpisodes();
  const recents = useRecents((s) => s.items);
  usePageTitle(t('legacy.nav.workshop'));
  const all = groups.flatMap((g) => g.episodes);
  const tab = TABS.includes(params.get('tab') as WorkshopTab) ? params.get('tab') : 'script';
  if (isLoading)
    return (
      <div className="assembly-workshop">
        <Loading />
      </div>
    );
  const pick = recents.find((r) => all.some((e) => e.id === r.id))?.id ?? all[0]?.id;
  if (pick) return <Navigate to={`/workshop/${pick}/${tab}`} replace />;
  return (
    <div className="art-fade">
      <div className="assembly-workshop">
        <Heading tab="script" />
        <Tabs tab="script" />
        <div className="eco-empty">
          <h3>{t('legacy.workshop.emptyTitle')}</h3>
          <p>{t('legacy.workshop.emptyBody')}</p>
          <button className="btn primary" onClick={() => navigate('/gallery?new=1')}>
            <Icon name="plus" />
            {t('legacy.workshop.createAlbum')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 创作工坊 for one storyboard (episode): legacy heading, tabs and 「当前分镜」 row. */
export default function WorkshopPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { episodeId } = useParams();
  const episode = useEpisode(episodeId);
  const series = useSeries(episode.data?.series_id);
  const patch = usePatchEpisode(episodeId ?? '');
  const create = useCreateEpisode(episode.data?.series_id ?? '');
  const { groups } = useAllEpisodes();
  const segments = useLocation().pathname.split('/');
  const rawTab = segments[3] ?? 'script';
  const tab: WorkshopTab | string =
    rawTab === 'ext' ? `ext/${segments[4] ?? ''}` : (rawTab as WorkshopTab);
  const known = TABS.includes(tab as WorkshopTab);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  usePageTitle(
    known ? t(`legacy.workshop.heads.${tab}`) : null,
    episode.data?.title,
    series.data?.title,
  );

  // Remember the visit (the palette and /workshop reopen it); forget deleted episodes.
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
      <div className="assembly-workshop">
        <Loading />
      </div>
    );
  if (episode.error || !episode.data || !series.data)
    return (
      <div className="assembly-workshop">
        <QueryError
          error={episode.error ?? series.error}
          onRetry={() => Promise.all([episode.refetch(), series.refetch()])}
        />
      </div>
    );

  const ep = episode.data;
  const go = (next: string) => navigate(`/workshop/${ep.id}/${next}`);
  const adopted = new Set(
    ep.takes.filter((x) => x.status === 'adopted' && !x.variant_id).map((x) => x.panel_id),
  );
  const done = ep.panels.filter((p) => adopted.has(p.id!)).length;

  const newStory = () =>
    create.mutate(
      {
        title: t('series.episodeNo', {
          n: (groups.find((g) => g.series.id === ep.series_id)?.episodes.length ?? 0) + 1,
        }),
      },
      { onSuccess: (e) => navigate(`/workshop/${e.id}/script`), onError: toastError },
    );

  const actions: Partial<Record<WorkshopTab, ReactNode>> = {
    script: (
      <>
        <button type="button" className="btn" onClick={() => navigate(`/series/${ep.series_id}`)}>
          <Icon name="book" />
          {t('legacy.workshop.openAlbum')}
        </button>
        <button type="button" className="btn" onClick={() => go('export')}>
          <Icon name="upload" />
          {t('legacy.workshop.export')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={create.isPending}
          title={t('legacy.workshop.newStoryIn', { title: series.data.title })}
          onClick={newStory}
        >
          <Icon name="plus" />
          {t('legacy.workshop.newStory')}
        </button>
      </>
    ),
    presets: (
      <button type="button" className="btn" onClick={() => navigate(`/series/${ep.series_id}`)}>
        <Icon name="book" />
        {t('legacy.workshop.openAlbum')}
      </button>
    ),
    board: (
      <button type="button" className="btn" onClick={() => navigate('/jobs')}>
        <Icon name="nodes" />
        {t('legacy.workshop.openQueue')}
      </button>
    ),
  };

  const saveTitle = () => {
    const title = draft.trim();
    if (title && title !== ep.title) patch.mutate({ title }, { onError: toastError });
    setRenaming(false);
  };

  return (
    <div className="art-fade">
      <div className={`assembly-workshop is-${rawTab}`}>
        <Heading
          tab={known ? (tab as WorkshopTab) : 'script'}
          actions={known ? actions[tab as WorkshopTab] : null}
        />
        <Tabs tab={tab} onTab={go} />
        <div className="workshop-asset-head">
          <label>
            {t('legacy.workshop.current')}
            {renaming ? (
              <input
                autoFocus
                value={draft}
                aria-label={t('common.title')}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
            ) : (
              <select
                id="workshop-story-select"
                value={ep.id}
                onChange={(e) =>
                  navigate(`/workshop/${e.target.value}/${rawTab === 'ext' ? 'script' : rawTab}`)
                }
              >
                {groups.map((g) => (
                  <optgroup key={g.series.id} label={g.series.title}>
                    {g.episodes.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.id === ep.id ? ep.title : e.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {groups.some((g) => g.episodes.some((e) => e.id === ep.id)) ? null : (
                  <option value={ep.id}>{ep.title}</option>
                )}
              </select>
            )}
          </label>
          <span className="workshop-autosave" data-state="saved">
            {t('legacy.workshop.autosaved')}
            {ep.panels.length ? (
              <span className="workshop-progress">
                {' · '}
                {t('legacy.workshop.progress', { done, total: ep.panels.length })}
              </span>
            ) : null}
          </span>
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (renaming) return saveTitle();
                setDraft(ep.title);
                setRenaming(true);
              }}
            >
              <Icon name="edit" />
              {renaming ? t('legacy.workshop.renameDone') : t('legacy.workshop.rename')}
            </button>
            {rawTab === 'board' ? (
              <button type="button" className="btn" onClick={() => go('script')}>
                <Icon name="story" />
                {t('legacy.workshop.toScript')}
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => go('board')}>
                <Icon name="arrow" />
                {t('legacy.workshop.toBoard')}
              </button>
            )}
          </div>
        </div>
        <div className="workspace-body workshop-body">
          <Outlet context={{ episode: ep, series: series.data } satisfies EpisodeContext} />
        </div>
      </div>
    </div>
  );
}
