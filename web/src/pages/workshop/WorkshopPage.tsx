import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { useRecents } from '../../app/recents';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import type { EpisodeContext } from '../episode/EpisodePage';
import { createStoryboard, importStoryboards } from './storyActions';
import { useStoryboardExport } from './ExportPicker';
import { PromptSurface } from './PromptSurface';
import StoryboardEditor, { useKnownVariables, usePromptSources } from './StoryboardEditor';

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
              onClick={() => navigate(`/workshop/${id}`)}
            >
              {t(`ws.tab.${id}`)}
            </button>
          ))}
        </nav>
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
  const ws = useWorkshop();
  const boards = useEpisodes(ws.data?.id);
  const recents = useRecents((s) => s.items);
  if (ws.error) return <QueryError error={ws.error} onRetry={() => ws.refetch()} />;
  if (!ws.data || boards.isLoading)
    return (
      <div className="assembly-workshop">
        <Loading />
      </div>
    );
  if (boards.error) return <QueryError error={boards.error} onRetry={boards.refetch} />;
  const items = boards.data?.items ?? [];
  const pick = recents.find((r) => items.some((e) => e.id === r.id))?.id ?? items[0]?.id;
  if (pick) return <Navigate to={`/workshop/story/${pick}`} replace />;
  return <StoryEmpty />;
}

function StoryEmpty() {
  const { t } = useTranslation();
  const ws = useWorkshop();
  const navigate = useNavigate();
  const create = useCreateEpisode(ws.data?.id ?? '');
  return (
    <WorkshopFrame tab="story">
      <div className="eco-empty">
        <h3>{t('ws.story.emptyTitle')}</h3>
        <p>{t('ws.story.emptyBody')}</p>
        <button
          type="button"
          className="btn primary"
          disabled={create.isPending}
          onClick={() =>
            createStoryboard(create, t)
              .then((e) => e && navigate(`/workshop/story/${e.id}`))
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { episodeId } = useParams();
  const ws = useWorkshop();
  const boards = useEpisodes(ws.data?.id);
  const episode = useEpisode(episodeId);
  const patch = usePatchEpisode(episodeId ?? '');
  const create = useCreateEpisode(ws.data?.id ?? '');
  const [renaming, setRenaming] = useState(false);
  const cancelRename = useRef(false);
  const [draft, setDraft] = useState('');
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
      <div className="assembly-workshop">
        <Loading />
      </div>
    );
  if (ws.error || episode.error || !ws.data || !episode.data)
    return (
      <div className="assembly-workshop">
        <QueryError
          error={ws.error ?? episode.error}
          onRetry={() => Promise.all([ws.refetch(), episode.refetch()])}
        />
      </div>
    );
  const ep = episode.data;
  // An album's episode opened through an old link: its frames live in the queue task.
  if (ep.series_id !== ws.data.id) return <Navigate to={`/workshop/assembly/${ep.id}`} replace />;

  const saveTitle = () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      setRenaming(false);
      return;
    }
    const title = draft.trim();
    if (title && title !== ep.title) patch.mutate({ title }, { onError: toastError });
    setRenaming(false);
  };
  const newBoard = async () => {
    const e = await createStoryboard(create, t);
    if (!e) return;
    await qc.invalidateQueries({ queryKey: keys.episodesOf(ws.data!.id!) });
    navigate(`/workshop/story/${e.id}`);
  };
  const importBoards = async () => {
    try {
      const { last, count } = await importStoryboards(create);
      if (last) {
        await qc.invalidateQueries({ queryKey: keys.episodesOf(ws.data!.id!) });
        navigate(`/workshop/story/${last}`);
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
          <button
            type="button"
            className="btn"
            onClick={importBoards}
            title={t('ws.story.importHint')}
          >
            <Icon name="download" />
            {t('ws.import')}
          </button>
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
      <div className="workshop-asset-head">
        <label>
          {t('ws.story.current')}
          {renaming ? (
            <input
              autoFocus
              onFocus={() => {
                cancelRename.current = false;
              }}
              value={draft}
              aria-label={t('ws.story.name')}
              onChange={(e) => setDraft(e.target.value)}
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
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <select
              id="workshop-story-select"
              value={ep.id}
              onChange={(e) => navigate(`/workshop/story/${e.target.value}`)}
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
            {renaming ? t('ws.done') : t('ws.rename')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`/workshop/assembly?story=${ep.id}`)}
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
        onSave={(synopsis) => patch.mutate({ synopsis }, { onError: toastError })}
        onSaveBase={(base_prompt) => patch.mutate({ base_prompt }, { onError: toastError })}
      />
      <Outlet
        key={`story-editor:${ep.id}`}
        context={{ episode: ep, series: ws.data } satisfies EpisodeContext}
      />
      {exporter.element}
    </WorkshopFrame>
  );
}

function Synopsis({
  episodeId,
  value,
  base: savedBase,
  onSave,
  onSaveBase,
}: {
  episodeId: string;
  value: string;
  base: string;
  onSave: (v: string) => void;
  onSaveBase: (v: string) => void;
}) {
  const { t } = useTranslation();
  const known = useKnownVariables();
  const sources = usePromptSources();
  const [text, setText] = useState(value);
  const last = useRef(value);
  const commit = () => {
    if (text !== last.current) {
      last.current = text;
      onSave(text);
    }
  };
  // 起手模板 lives on the storyboard; follow outside changes (批量新增 → 保存为起手模板) unless the
  // field holds unsaved typing.
  const [base, setBase] = useState(savedBase);
  const lastBase = useRef(savedBase);
  useEffect(() => {
    setBase((current) => (current === lastBase.current ? savedBase : current));
    lastBase.current = savedBase;
  }, [savedBase]);
  const commitBase = () => {
    if (base !== lastBase.current) {
      lastBase.current = base;
      onSaveBase(base);
    }
  };
  // Before the field existed the template was kept in this browser only: move it over once.
  const migrate = useRef({ savedBase, onSaveBase });
  useEffect(() => {
    const key = basePromptKey(episodeId);
    const local = localStorage.getItem(key);
    if (local === null) return;
    const { savedBase: current, onSaveBase: save } = migrate.current;
    if (!current && local.trim()) {
      lastBase.current = local;
      setBase(local);
      save(local);
    }
    localStorage.removeItem(key);
  }, [episodeId]);
  return (
    <details className="story-synopsis">
      <summary>{t('ws.story.synopsis')}</summary>
      <div className="field">
        <label className="label" htmlFor="workshop-outline">
          {t('ws.story.outline')}
        </label>
        <textarea
          id="workshop-outline"
          className="workshop-outline"
          value={text}
          placeholder={t('ws.story.outlineHint')}
          onChange={(e) => setText(e.target.value)}
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
          value={base}
          known={known}
          sources={sources}
          placeholder={t('ws.story.baseHint')}
          onChange={setBase}
          onBlur={commitBase}
        />
        <p className="help">{t('ws.story.baseHelp')}</p>
      </div>
    </details>
  );
}

/** Classic: the legacy frames editor. Studio mode: the full panel workbench. */
export function StoryBody() {
  const studio = useUI((s) => s.studioMode);
  return studio ? <StudioScript /> : <StoryboardEditor />;
}

function StudioScript() {
  const [Comp, setComp] = useState<null | (() => ReactNode)>(null);
  useEffect(() => {
    let live = true;
    import('../script/ScriptTab').then((m) => live && setComp(() => m.default));
    return () => {
      live = false;
    };
  }, []);
  return Comp ? (
    <div className="workspace-body workshop-body">
      <Comp />
    </div>
  ) : (
    <Loading />
  );
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
  if (episode.error) return <Navigate to="/workshop" replace />;
  if (!ws.data || !episode.data) return <Loading />;
  const ep = episode.data;
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
