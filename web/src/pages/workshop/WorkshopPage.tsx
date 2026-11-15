import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../../api/keys';
import {
  useCreateEpisode,
  useEpisode,
  useEpisodes,
  usePatchEpisode,
  useSeries,
} from '../../api/series';
import { useWorkshop } from '../../api/workshop';
import type { Series } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { useRecents } from '../../app/recents';
import { usePageTitle } from '../../app/title';
import { useAutoDraft } from '../../app/useAutoDraft';
import { SaveState } from '../../components/SaveState';
import { toast, toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import type { EpisodeContext } from '../episode/EpisodePage';
import { createStoryboard, importStoryboards } from './storyActions';
import { useStoryboardExport } from './ExportPicker';
import { CreationKitImport } from './CreationKitImport';
import { CheckpointDialog } from './CheckpointDialog';
import { EpisodeOrganizeMenu } from '../longform/EpisodeOrganizeMenu';
import { PromptSurface } from './PromptSurface';
import StoryboardEditor, { useKnownVariables, usePromptSources } from './StoryboardEditor';
import {
  useWorkshopSource,
  WorkshopSourcePicker,
  WorkshopDraftBoundary,
  WorkshopDraftGuard,
  workshopHref,
} from './workshopSource';

/** Where the template lived before it moved onto the storyboard (moved over once on open). */
const basePromptKey = (id: string) => `mio.basePrompt.${id}`;

export type WorkshopTab = 'story' | 'presets' | 'assembly';
const TABS: WorkshopTab[] = ['story', 'presets', 'assembly'];

/** Legacy heading (kicker, title, one line) + the three quiet tabs, shared by every tab. */
export function WorkshopFrame({
  tab,
  actions,
  children,
}: {
  tab: WorkshopTab;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  usePageTitle(t(`ws.head.${tab}`));
  return (
    <div className="art-fade">
      <div className={`assembly-workshop is-${tab}`}>
        <header className="workshop-heading">
          <div>
            <span className="context-kicker">{t('ws.kicker')}</span>
            <h1>{t(`ws.head.${tab}`)}</h1>
            <p>{t(`ws.lede.${tab}`)}</p>
          </div>
          {actions ? (
            <div className="workshop-heading-actions" role="group">
              {actions}
            </div>
          ) : null}
        </header>
        <nav className="quiet-tabs workshop-tabs" aria-label={t('ws.tabsLabel')}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'active' : ''}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => navigate(workshopHref(`/workshop/${id}`, params.get('kit') ?? ''))}
            >
              {t(`ws.tab.${id}`)}
            </button>
          ))}
        </nav>
        {tab !== 'assembly' ? <WorkshopSourcePicker key={tab} tab={tab} /> : null}
        {children}
      </div>
    </div>
  );
}

export function Autosave({ saving, error }: { saving?: boolean; error?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className="workshop-autosave"
      data-state={error ? 'error' : saving ? 'saving' : 'saved'}
      role="status"
    >
      {error ? t('ws.saveFailed') : saving ? t('ws.saving') : t('ws.autosaved')}
    </span>
  );
}

/** `/workshop/story` — reopen the last storyboard (or the first one). */
export function StoryIndex() {
  const ws = useWorkshopSource();
  const boards = useEpisodes(ws.data?.id);
  const recents = useRecents((s) => s.items);
  if (ws.error)
    return (
      <WorkshopFrame tab="story">
        <QueryError error={ws.error} onRetry={() => ws.refetch()} />
      </WorkshopFrame>
    );
  if (!ws.data || boards.isLoading)
    return (
      <div className="assembly-workshop">
        <Loading />
      </div>
    );
  if (boards.error) return <QueryError error={boards.error} onRetry={boards.refetch} />;
  const items = boards.data?.items ?? [];
  const pick = recents.find((r) => items.some((e) => e.id === r.id))?.id ?? items[0]?.id;
  if (pick) return <Navigate to={workshopHref(`/workshop/story/${pick}`, ws.kitId)} replace />;
  return <StoryEmpty />;
}

function StoryEmpty() {
  const { t } = useTranslation();
  const ws = useWorkshopSource();
  const navigate = useNavigate();
  const create = useCreateEpisode(ws.data?.id ?? '');
  return (
    <WorkshopFrame
      tab="story"
      actions={
        <CreationKitImport
          label={t('ws.import')}
          legacyLabel={t('kits.json')}
          onLegacy={() => {
            void importStoryboards(create)
              .then(({ last }) => {
                if (last) navigate(workshopHref(`/workshop/story/${last}`, ws.kitId));
              })
              .catch(toastError);
          }}
        />
      }
    >
      <div className="eco-empty">
        <h3>{t('ws.story.emptyTitle')}</h3>
        <p>{t('ws.story.emptyBody')}</p>
        <button
          type="button"
          className="btn primary"
          disabled={create.isPending}
          onClick={() =>
            createStoryboard(create, t)
              .then((e) => e && navigate(workshopHref(`/workshop/story/${e.id}`, ws.kitId)))
              .catch(toastError)
          }
        >
          <Icon name="plus" />
          {t('ws.story.new')}
        </button>
      </div>
    </WorkshopFrame>
  );
}

/** 分镜工坊 for one storyboard: 「当前分镜」 row, synopsis, and the frames editor. */
export function StoryTab() {
  const { episodeId } = useParams();
  const [params] = useSearchParams();
  return (
    <WorkshopDraftBoundary key={`${params.get('kit') ?? ''}:${episodeId}`}>
      <StoryTabContent />
    </WorkshopDraftBoundary>
  );
}

function StoryTabContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { episodeId } = useParams();
  const ws = useWorkshopSource();
  const boards = useEpisodes(ws.data?.id);
  const episode = useEpisode(episodeId);
  const patch = usePatchEpisode(episodeId ?? '');
  const create = useCreateEpisode(ws.data?.id ?? '');
  const [renaming, setRenaming] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const cancelRename = useRef(false);
  const titleDraft = useAutoDraft(episode.data?.title ?? '', async (value) => {
    const title = value.trim();
    if (!title) throw new Error(t('workshopSource.titleRequired'));
    if (title !== episode.data?.title) await patch.mutateAsync({ title });
  });
  const { visit, forget } = useRecents();
  const exporter = useStoryboardExport(ws.data?.id, episode.data?.id);
  const loaded = episode.data;
  useEffect(() => {
    if (loaded && ws.data && loaded.series_id === ws.data.id)
      visit({ id: loaded.id!, title: loaded.title, seriesId: loaded.series_id, seriesTitle: '' });
    else if (episode.error && episodeId) forget(episodeId);
  }, [loaded, ws.data, episode.error, episodeId, visit, forget]);

  if (ws.isLoading || episode.isLoading)
    return (
      <WorkshopFrame tab="story">
        <Loading />
      </WorkshopFrame>
    );
  if (ws.error || episode.error || !ws.data || !episode.data)
    return (
      <WorkshopFrame tab="story">
        <QueryError
          error={ws.error ?? episode.error}
          onRetry={() => Promise.all([ws.refetch(), episode.refetch()])}
        />
      </WorkshopFrame>
    );
  const ep = episode.data;
  // An album's episode opened through an old link: its frames live in the queue task.
  if (ep.series_id !== ws.data.id) {
    if (ws.kitId)
      return (
        <WorkshopFrame tab="story">
          <QueryError error={new Error(t('workshopSource.mismatch'))} />
        </WorkshopFrame>
      );
    return <Navigate to={`/workshop/assembly/${ep.id}`} replace />;
  }

  const saveTitle = () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      titleDraft.change(ep.title);
      titleDraft.discard();
      setRenaming(false);
      return;
    }
    void titleDraft
      .flushAll()
      .then(() => setRenaming(false))
      .catch(toastError);
  };
  const newBoard = async () => {
    const e = await createStoryboard(create, t);
    if (!e) return;
    await qc.invalidateQueries({ queryKey: keys.episodesOf(ws.data!.id!) });
    navigate(workshopHref(`/workshop/story/${e.id}`, ws.kitId));
  };
  const importBoards = async () => {
    try {
      const { last, count } = await importStoryboards(create);
      if (last) {
        await qc.invalidateQueries({ queryKey: keys.episodesOf(ws.data!.id!) });
        navigate(workshopHref(`/workshop/story/${last}`, ws.kitId));
        toast(t('ws.imported', { count }));
      }
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <WorkshopFrame
      tab="story"
      actions={
        <>
          <CreationKitImport
            label={t('ws.import')}
            legacyLabel={t('kits.json')}
            onLegacy={() => void importBoards()}
          />
          <button
            type="button"
            className="btn"
            disabled={patch.isPending || renaming}
            title={t('ws.exportPick.storyHint')}
            onClick={exporter.open}
          >
            <Icon name="upload" />
            {t('ws.exportDots')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={create.isPending}
            onClick={() => newBoard().catch(toastError)}
          >
            <Icon name="plus" />
            {t('ws.story.new')}
          </button>
        </>
      }
    >
      <WorkshopDraftGuard save={titleDraft} />
      <div className="workshop-asset-head">
        <label>
          {t('ws.story.current')}
          {renaming ? (
            <input
              autoFocus
              onFocus={() => {
                cancelRename.current = false;
              }}
              value={titleDraft.value}
              aria-label={t('ws.story.name')}
              onChange={(e) => titleDraft.change(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename.current = true;
                  saveTitle();
                }
              }}
            />
          ) : (
            <select
              id="workshop-story-select"
              value={ep.id}
              onChange={(e) =>
                navigate(workshopHref(`/workshop/story/${e.target.value}`, ws.kitId))
              }
            >
              {(boards.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id === ep.id ? ep.title : b.title}
                  {' · '}
                  {t('ws.story.frames', {
                    count: b.id === ep.id ? ep.panels.length : b.panel_count,
                  })}
                </option>
              ))}
            </select>
          )}
        </label>
        <Autosave saving={patch.isPending} error={patch.isError} />
        <div>
          <EpisodeOrganizeMenu
            episode={ep}
            onCopied={(copy) => navigate(workshopHref(`/workshop/story/${copy.id}`, ws.kitId))}
            actions={[{ label: t('recovery.title'), onSelect: () => setCheckpointsOpen(true) }]}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (renaming) return saveTitle();
              setRenaming(true);
            }}
          >
            <Icon name="edit" />
            {renaming ? t('ws.done') : t('ws.rename')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(workshopHref('/workshop/assembly', ws.kitId, { story: ep.id }))}
          >
            <Icon name="arrow" />
            {t('ws.story.toAssembly')}
          </button>
        </div>
      </div>
      <Synopsis
        key={ep.id}
        episodeId={ep.id!}
        value={ep.synopsis}
        base={ep.base_prompt ?? ''}
        series={ws.data}
        onSave={(changes) => patch.mutateAsync(changes)}
      />
      <Outlet
        key={`story-editor:${ep.id}`}
        context={{ episode: ep, series: ws.data } satisfies EpisodeContext}
      />
      {exporter.element}
      {checkpointsOpen ? (
        <CheckpointDialog
          seriesId={ws.data.id}
          title={ws.data.title}
          onClose={() => setCheckpointsOpen(false)}
        />
      ) : null}
    </WorkshopFrame>
  );
}

function Synopsis({
  episodeId,
  value,
  base: savedBase,
  series,
  onSave,
}: {
  episodeId: string;
  value: string;
  base: string;
  series: Series;
  onSave: (changes: { synopsis: string; base_prompt: string }) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const known = useKnownVariables(series);
  const sources = usePromptSources(series);
  const draft = useAutoDraft({ synopsis: value, base_prompt: savedBase }, onSave);
  const commit = () => void draft.flushAll().catch(toastError);
  // Before the field existed the template was kept in this browser only: move it over once.
  const migrate = useRef({ savedBase, draft });
  useEffect(() => {
    const key = basePromptKey(episodeId);
    const local = localStorage.getItem(key);
    if (local === null) return;
    const { savedBase: current, draft: save } = migrate.current;
    if (!current && local.trim()) {
      save.change((old) => ({ ...old, base_prompt: local }));
      void save
        .flushAll()
        .then(() => localStorage.removeItem(key))
        .catch(toastError);
      return;
    }
    localStorage.removeItem(key);
  }, [episodeId]);
  return (
    <details className="story-synopsis">
      <WorkshopDraftGuard save={draft} />
      <summary>{t('ws.story.synopsis')}</summary>
      <div className="field">
        <label className="label" htmlFor="workshop-outline">
          {t('ws.story.outline')}
        </label>
        <textarea
          id="workshop-outline"
          className="workshop-outline"
          value={draft.value.synopsis}
          placeholder={t('ws.story.outlineHint')}
          onChange={(e) => draft.change((old) => ({ ...old, synopsis: e.target.value }))}
          onBlur={commit}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="workshop-base-prompt">
          {t('ws.story.base')}
        </label>
        <PromptSurface
          id="workshop-base-prompt"
          className="workshop-base-prompt"
          value={draft.value.base_prompt}
          known={known}
          sources={sources}
          placeholder={t('ws.story.baseHint')}
          onChange={(base_prompt) => draft.change((old) => ({ ...old, base_prompt }))}
          onBlur={commit}
        />
        <p className="help">{t('ws.story.baseHelp')}</p>
        <SaveState state={draft.state} />
        {draft.state === 'error' ? (
          <button type="button" className="btn small" onClick={commit}>
            {t('common.save')}
          </button>
        ) : null}
      </div>
    </details>
  );
}

/** 分镜工坊: the frames editor. Per-panel detail work happens in the assembly script tab. */
export function StoryBody() {
  return <StoryboardEditor />;
}

/**
 * Old links (`/workshop/:id/script`, `/episodes/:id/board`, …): storyboards open in 分镜工坊,
 * an album's pages open in its reader (排版 / 导出) or its queue task (候选).
 */
export function LegacyRedirect() {
  const { episodeId } = useParams();
  const segments = useLocation().pathname.split('/');
  const rest = segments[3] ?? 'script';
  const ws = useWorkshop();
  const episode = useEpisode(episodeId);
  const source = useSeries(episode.data?.series_id);
  if (episode.error) return <Navigate to="/workshop" replace />;
  if (source.error) return <QueryError error={source.error} onRetry={source.refetch} />;
  if (!ws.data || !episode.data || !source.data) return <Loading />;
  const ep = episode.data;
  if (source.data?.kind === 'kit')
    return <Navigate to={workshopHref(`/workshop/story/${ep.id}`, ep.series_id)} replace />;
  if (ep.series_id === ws.data.id) return <Navigate to={`/workshop/story/${ep.id}`} replace />;
  const reader = `/gallery/${ep.series_id}`;
  const to =
    rest === 'canvas'
      ? `${reader}/layout?ep=${ep.id}`
      : rest === 'export'
        ? `${reader}/export?ep=${ep.id}`
        : rest === 'read'
          ? `${reader}?ep=${ep.id}`
          : rest === 'script' || rest === 'presets'
            ? `/workshop/assembly/${ep.id}/script`
            : `/workshop/assembly/${ep.id}/board`;
  return <Navigate to={to} replace />;
}

/** A queued album's pages: candidates to pick from (and, if needed, the panel prompts). */
export function TaskDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { episodeId } = useParams();
  const { pathname } = useLocation();
  const episode = useEpisode(episodeId);
  const series = useSeries(episode.data?.series_id);
  if (episode.error) return <QueryError error={episode.error} onRetry={() => episode.refetch()} />;
  if (!episode.data || !series.data)
    return (
      <div className="assembly-workshop">
        <Loading />
      </div>
    );
  if (series.data.kind === 'kit')
    return (
      <Navigate to={workshopHref(`/workshop/story/${episode.data.id}`, series.data.id)} replace />
    );
  const script = pathname.endsWith('/script');
  const base = `/workshop/assembly/${episodeId}/board`;
  return (
    <WorkshopFrame
      tab="assembly"
      actions={
        <>
          <button type="button" className="btn" onClick={() => navigate('/workshop/assembly')}>
            <Icon name="arrow" className="is-back" />
            {t('ws.task.back')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/gallery/${series.data.id}`)}
          >
            <Icon name="book" />
            {t('ws.queue.read')}
          </button>
        </>
      }
    >
      <div className="workshop-asset-head is-task">
        <label>
          {t('ws.task.album')}
          <strong>{series.data.title}</strong>
        </label>
        <div className="segmented" role="group" aria-label={t('ws.task.views')}>
          <button
            type="button"
            className={script ? '' : 'active'}
            aria-pressed={!script}
            onClick={() => navigate(base)}
          >
            {t('ws.task.candidates')}
          </button>
          <button
            type="button"
            className={script ? 'active' : ''}
            aria-pressed={script}
            onClick={() => navigate(`/workshop/assembly/${episodeId}/script`)}
          >
            {t('ws.task.script')}
          </button>
        </div>
      </div>
      <div className="workspace-body workshop-body">
        <Outlet
          key={`task-editor:${episode.data.id}`}
          context={{ episode: episode.data, series: series.data } satisfies EpisodeContext}
        />
      </div>
    </WorkshopFrame>
  );
}
