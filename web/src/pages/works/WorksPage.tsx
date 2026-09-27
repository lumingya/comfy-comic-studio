import { Download, FolderInput, ImageIcon, Pencil, Search, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { BulkBar, useBulkActions } from './BulkBar';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { assetUrl, download } from '../../api/client';
import { useSeriesList, useTrashSeries } from '../../api/series';
import { useImportBundle, usePatchSettings, useSettings } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { useSelection, type Modifiers } from '../../app/selection';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { ContextMenu, useContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { useUndoTrash } from '../../components/undo';
import { ActionMenu, Empty, FilePick, InlineTitle, type MenuAction } from '../../components/ui';
import { CoverPicker } from './CoverPicker';
import { Parchment, Showcase, ShowcaseNav, StarButton } from './Showcase';
import { WorksHero } from './WorksHero';

const STATUSES = ['draft', 'active', 'archived'] as const;
/** Legacy key: the one-line multi-select hint stays hidden once used or dismissed. */
const HINT_KEY = 'cc-hint-multiselect';
type Status = (typeof STATUSES)[number];
const SORTS = ['updated', 'title', 'created'] as const;
type Sort = (typeof SORTS)[number];

export interface WorksFilter {
  q: string;
  status: Status | '';
  sort: Sort;
}

/** Search (title / subtitle), status and sort, all client-side. Exported for tests. */
export function filterWorks(items: SeriesCard[], f: WorksFilter, locale: string): SeriesCard[] {
  const q = f.q.trim().toLocaleLowerCase(locale);
  const out = items.filter((s) => {
    if (f.status && (s.status ?? 'draft') !== f.status) return false;
    if (!q) return true;
    return `${s.title}\n${s.subtitle ?? ''}`.toLocaleLowerCase(locale).includes(q);
  });
  const collator = new Intl.Collator(locale, { numeric: true });
  return out.sort((a, b) => {
    if (f.sort === 'title') return collator.compare(a.title, b.title);
    const key = f.sort === 'created' ? 'created_at' : 'updated_at';
    return (b[key] ?? '').localeCompare(a[key] ?? '');
  });
}

function FilterBar(props: {
  items: SeriesCard[];
  filter: WorksFilter;
  onChange: (patch: Partial<WorksFilter>) => void;
  starredOnly: boolean;
  onStarredOnly: (on: boolean) => void;
  bulk: boolean;
  onBulk: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const view = useUI((s) => s.worksView);
  const setView = useUI((s) => s.setWorksView);
  const counts = useMemo(() => {
    const c: Record<Status, number> = { draft: 0, active: 0, archived: 0 };
    for (const s of props.items) c[(s.status ?? 'draft') as Status]++;
    return c;
  }, [props.items]);
  return (
    <div className="collection-toolbar shelf-toolbar" role="search">
      <div className="search-field">
        <Icon name="search" />
        <input
          type="search"
          id="gallery-search"
          value={props.filter.q}
          placeholder={t('works.search')}
          aria-label={t('works.search')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => props.onChange({ q: e.target.value })}
        />
      </div>
      <span className="spacer" />
      <button
        type="button"
        className={`filter-link ${props.starredOnly ? 'active' : ''}`}
        aria-pressed={props.starredOnly}
        onClick={() => props.onStarredOnly(!props.starredOnly)}
      >
        <Icon name="star" sm className={props.starredOnly ? 'is-filled' : ''} />
        {t('classic.shelf.starred')}
      </button>
      <button
        type="button"
        className={`filter-link bulk-toggle ${props.bulk ? 'active' : ''}`}
        aria-pressed={props.bulk}
        title={t('classic.shelf.bulkHint')}
        onClick={() => props.onBulk(!props.bulk)}
      >
        <Icon name="check" sm />
        {t('classic.shelf.bulk')}
      </button>
      <select
        id="gallery-filter"
        aria-label={t('series.statusLabel')}
        value={props.filter.status}
        onChange={(e) => props.onChange({ status: e.target.value as Status | '' })}
      >
        <option value="">{t('legacy.allAlbums')}</option>
        {STATUSES.map((st) => (
          <option key={st} value={st}>
            {t(`series.status.${st}`)} · {counts[st]}
          </option>
        ))}
      </select>
      <select
        id="gallery-sort"
        aria-label={t('works.sortLabel')}
        value={props.filter.sort}
        onChange={(e) => props.onChange({ sort: e.target.value as Sort })}
      >
        {SORTS.map((v) => (
          <option key={v} value={v}>
            {t(`works.sort.${v}`)}
          </option>
        ))}
      </select>
      <div className="shelf-view-switch" role="group" aria-label={t('classic.shelf.view')}>
        <button
          type="button"
          className={view === 'showcase' ? 'active' : ''}
          aria-pressed={view === 'showcase'}
          title={t('classic.shelf.showcase')}
          onClick={() => setView('showcase')}
        >
          <Icon name="image" sm />
          <span>{t('classic.shelf.showcase')}</span>
        </button>
        <button
          type="button"
          className={view === 'grid' ? 'active' : ''}
          aria-pressed={view === 'grid'}
          title={t('classic.shelf.grid')}
          onClick={() => setView('grid')}
        >
          <Icon name="grid" sm />
          <span>{t('classic.shelf.grid')}</span>
        </button>
      </div>
    </div>
  );
}

/** Export / change cover / delete, shared by the showcase and the grid card. */
function useBookActions(onChangeCover: (series: SeriesCard) => void) {
  const { t } = useTranslation();
  const trash = useTrashSeries();
  const undo = useUndoTrash();
  return (series: SeriesCard): MenuAction[] => [
    {
      label: t('classic.shelf.changeCover'),
      icon: <ImageIcon size={14} />,
      onSelect: () => onChangeCover(series),
    },
    {
      label: t('works.exportBundle'),
      icon: <Download size={14} />,
      onSelect: () =>
        download(`/api/series/${series.id}/bundle`, `${series.title}.mio.zip`).catch(toastError),
    },
    {
      label: t('common.delete'),
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () =>
        trash.mutate(series.id!, {
          onSuccess: () => undo('series', series.id!, series.title),
          onError: toastError,
        }),
    },
  ];
}

function SeriesCardView(props: {
  series: SeriesCard;
  index: number;
  actions: MenuAction[];
  /** Touch 批量管理 mode: the cover toggles selection instead of opening the reader. */
  selecting?: boolean;
  selected?: boolean;
  /** Ctrl / ⌘ / Shift + click, or any click while `selecting`. */
  onSelect?: (mods: Modifiers) => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { series } = props;
  const status = series.status ?? 'draft';
  const date = (series.updated_at ?? '').slice(5, 10).replace('-', '.');
  return (
    <article
      className={`shelf-item ${props.selecting ? 'is-selecting' : ''} ${props.selected ? 'is-selected' : ''}`}
      style={{ '--i': props.index } as CSSProperties}
      aria-label={series.title}
      aria-selected={props.selected || undefined}
      onContextMenu={props.onContextMenu}
    >
      <button
        className="shelf-cover book-cover"
        style={{ '--cover-ratio': 0.75, '--cover-fit': 'cover' } as CSSProperties}
        data-cover-mode="grid"
        aria-label={series.title}
        aria-pressed={props.selecting ? !!props.selected : undefined}
        onClick={(e) => {
          if (props.selecting || e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            props.onSelect?.(props.selecting ? { ctrlKey: true } : e);
          } else navigate(`/gallery/${series.id}`);
        }}
      >
        {props.selecting || props.selected ? (
          <span className="bulk-check" aria-hidden>
            {props.selected ? <Icon name="check" sm /> : null}
          </span>
        ) : null}
        {series.cover_asset_id ? (
          <img src={assetUrl(series.cover_asset_id, 640)} alt={series.title} loading="lazy" />
        ) : (
          <Parchment series={series} />
        )}
        <span className="cover-paper" aria-hidden />
        <span className="pic-count">▧ {series.adopted_count ?? 0}</span>
      </button>
      <div className="edition-tile-footer">
        <h3>{series.title}</h3>
        <StarButton series={series} small />
        <ActionMenu actions={props.actions} />
      </div>
      <div className="edition-tile-meta">
        <span>{t('classic.shelf.frames', { count: series.panel_count ?? 0 })}</span>
        <span className={`status-label status-${status}`}>{t(`series.status.${status}`)}</span>
        <time dateTime={series.updated_at}>{date}</time>
      </div>
    </article>
  );
}

/** The collection (画册集) name as the page heading, renamed in place. */
function CollectionTitle() {
  const { t } = useTranslation();
  const settings = useSettings();
  const patch = usePatchSettings();
  const title = settings.data?.collection_title || t('classic.shelf.defaultTitle');
  usePageTitle(title);
  return (
    <h1 className="collection-title">
      <InlineTitle
        className="collection-title-input"
        value={title}
        label={t('classic.shelf.rename')}
        onSave={(collection_title) => patch.mutate({ collection_title }, { onError: toastError })}
      />
      <Pencil size={15} className="collection-title-pen" aria-hidden />
    </h1>
  );
}

function SkeletonGrid() {
  return (
    <div className="work-grid" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="work-card book-card">
          <div className="work-cover book-cover skeleton" />
          <div className="work-body">
            <div className="skeleton" style={{ height: 18, width: '60%' }} />
            <div className="skeleton" style={{ height: 12, width: '40%', marginTop: 10 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function WorksPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const list = useSeriesList();
  // Filter state lives in the URL so Back returns to the same view.
  const [params, setParams] = useSearchParams();
  const filter: WorksFilter = {
    q: params.get('q') ?? '',
    status: (STATUSES as readonly string[]).includes(params.get('status') ?? '')
      ? (params.get('status') as Status)
      : '',
    sort: (SORTS as readonly string[]).includes(params.get('sort') ?? '')
      ? (params.get('sort') as Sort)
      : 'updated',
  };
  const setFilter = (patch: Partial<WorksFilter>) => {
    const next = { ...filter, ...patch };
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.status) p.set('status', next.status);
    if (next.sort !== 'updated') p.set('sort', next.sort);
    if (params.get('starred') === '1') p.set('starred', '1');
    setParams(p, { replace: true });
  };
  const setStarredOnly = (on: boolean) => {
    const p = new URLSearchParams(params);
    if (on) p.set('starred', '1');
    else p.delete('starred');
    setParams(p, { replace: true });
  };
  const filtered = useMemo(
    () => (list.data ? filterWorks(list.data, filter, i18n.language) : []),
    [list.data, filter.q, filter.status, filter.sort, i18n.language],
  );
  const starred = useUI((s) => s.starred);
  const starredOnly = params.get('starred') === '1';
  const books = useMemo(
    () => (starredOnly ? filtered.filter((s) => starred.includes(s.id!)) : filtered),
    [filtered, starred, starredOnly],
  );
  const view = useUI((s) => s.worksView);
  // Multi-select (legacy desktop selection): Ctrl / ⌘ / Shift + click, right-click for batch
  // actions, Ctrl+A / Esc / Delete. 批量管理 is the touch fallback that makes a tap select.
  const [bulk, setBulk] = useState(false);
  const bookIds = useMemo(() => books.map((b) => b.id!), [books]);
  const selection = useSelection(bookIds);
  const chosen = books.filter((b) => selection.has(b.id!));
  const selecting = bulk || selection.ids.length > 1;
  const bulkActions = useBulkActions(() => selection.clear());
  const menu = useContextMenu<string[]>();
  const setBulkMode = (on: boolean) => {
    setBulk(on);
    selection.clear();
  };
  const [hintSeen, setHintSeen] = useState(() => localStorage.getItem(HINT_KEY) === 'seen');
  const seeHint = () => {
    localStorage.setItem(HINT_KEY, 'seen');
    setHintSeen(true);
  };
  useEffect(() => {
    if (selection.ids.length > 1 && !hintSeen) seeHint();
  });
  useEffect(() => {
    if (view !== 'grid' && !selecting) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (e.key === 'Escape' && (bulk || selection.ids.length)) setBulkMode(false);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.length)
        void bulkActions.remove(chosen);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.all();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // The featured book (showcase); back to the first one whenever the filter changes.
  const [featured, setFeatured] = useState(0);
  const filterKey = `${filter.q}|${filter.status}|${filter.sort}|${starredOnly}`;
  useEffect(() => setFeatured(0), [filterKey]);
  const index = Math.min(featured, Math.max(0, books.length - 1));
  const firstEditionId = useMemo(
    () =>
      [...(list.data ?? [])].sort((a, b) =>
        (a.created_at ?? '').localeCompare(b.created_at ?? ''),
      )[0]?.id,
    [list.data],
  );
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const coverSeries = list.data?.find((s) => s.id === coverFor);
  const actions = useBookActions((s) => setCoverFor(s.id!));
  const importBundle = useImportBundle();
  // 画册集 is for reading; a new album starts in 创作工坊 (装配 → 新建生成任务).
  const create = () => navigate('/workshop/assembly?new=1');
  useEffect(() => {
    if (params.get('new') === '1') navigate('/workshop/assembly?new=1', { replace: true });
  }, [params, navigate]);

  /** Right-click: one album gets its own actions, a multi-selection gets the batch ones. */
  const shelfMenu = (ids: string[]): ContextGroup[] => {
    const targets = books.filter((b) => ids.includes(b.id!));
    const one = targets.length === 1 ? targets[0] : undefined;
    const starredAll = bulkActions.allStarred(targets);
    return [
      {
        heading:
          targets.length > 1
            ? t('classic.shelf.bulkSelected', { count: targets.length })
            : one?.title,
        items: [
          ...(one
            ? [
                {
                  label: t('classic.shelf.open'),
                  icon: <Icon name="book" sm />,
                  shortcut: 'Enter',
                  onSelect: () => navigate(`/gallery/${one.id}`),
                },
                {
                  label: t('classic.shelf.changeCover'),
                  icon: <Icon name="image" sm />,
                  onSelect: () => setCoverFor(one.id!),
                },
              ]
            : []),
          {
            label: starredAll ? t('classic.shelf.unstar') : t('classic.shelf.star'),
            icon: <Icon name="star" sm />,
            onSelect: () => bulkActions.star(targets),
          },
          {
            label: one ? t('works.exportBundle') : t('classic.shelf.bulkExportHint'),
            icon: <Icon name="download" sm />,
            disabled: bulkActions.busy,
            onSelect: () => void bulkActions.exportAll(targets),
          },
        ],
      },
      {
        items: [
          {
            label: t('common.delete'),
            icon: <Icon name="trash" sm />,
            danger: true,
            shortcut: 'Del',
            disabled: bulkActions.busy,
            onSelect: () => void bulkActions.remove(targets),
          },
        ],
      },
    ];
  };

  const onBundle = (file: File) =>
    importBundle.mutate(file, {
      onSuccess: (r) => {
        toast(t('works.imported', { count: 1 }));
        navigate(`/gallery/${r.series_id}`);
      },
      onError: toastError,
    });

  return (
    <div className="art-fade">
      <section className="art-fade" id="collection-home">
        <div className="collection-heading">
          <div className="grow">
            <div className="overline">{t('classic.works.eyebrow')}</div>
            <CollectionTitle />
            <p>{t('works.sub')}</p>
          </div>
          <div className="resource-actions">
            <FilePick
              accept=".zip,application/zip"
              onFile={onBundle}
              disabled={importBundle.isPending}
            >
              <Icon name="download" />
              {t('works.importBundle')}
            </FilePick>
            <button className="btn primary" onClick={create}>
              <Icon name="plus" />
              {t('works.newSeries')}
            </button>
          </div>
        </div>

        {list.isLoading ? <SkeletonGrid /> : null}
        {list.error ? <QueryError error={list.error} onRetry={list.refetch} /> : null}
        {list.data && !list.data.length ? (
          <WorksHero
            onCreate={create}
            importAction={
              <FilePick accept=".zip,application/zip" onFile={onBundle}>
                <FolderInput size={15} /> {t('works.importBundle')}
              </FilePick>
            }
          />
        ) : null}
        {list.data?.length ? (
          <FilterBar
            items={list.data}
            filter={filter}
            onChange={setFilter}
            starredOnly={starredOnly}
            onStarredOnly={setStarredOnly}
            bulk={bulk}
            onBulk={setBulkMode}
          />
        ) : null}
        {list.data?.length ? (
          <div className="shelf-index">
            <span>{t('classic.shelf.count', { count: books.length })}</span>
            {view === 'showcase' && !selecting && books.length ? (
              <ShowcaseNav index={index} total={books.length} onIndex={setFeatured} />
            ) : null}
          </div>
        ) : null}
        {list.data?.length && !books.length ? (
          <Empty
            compact
            icon={starredOnly ? <Star size={20} /> : <Search size={20} />}
            title={
              starredOnly && !filter.q && !filter.status
                ? t('classic.shelf.noStarred')
                : t('works.noMatch')
            }
            action={
              <button
                className="btn"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
              >
                {t('works.clearFilters')}
              </button>
            }
          />
        ) : null}
        {selecting && books.length ? (
          <BulkBar
            books={books}
            chosen={chosen}
            actions={bulkActions}
            onAll={selection.all}
            onNone={selection.clear}
            onExit={() => setBulkMode(false)}
          />
        ) : null}
        {books.length && view === 'showcase' && !selecting ? (
          <Showcase
            books={books}
            index={index}
            onIndex={setFeatured}
            firstEditionId={firstEditionId}
            actions={actions}
            onChangeCover={(s) => setCoverFor(s.id!)}
          />
        ) : null}
        {books.length > 1 && view === 'grid' && !selecting && !hintSeen ? (
          <p className="multiselect-hint">
            <span>{t('classic.shelf.multiHint')}</span>
            <button type="button" className="link-button" onClick={seeHint}>
              {t('classic.shelf.multiHintOk')}
            </button>
          </p>
        ) : null}
        {books.length && (view === 'grid' || selecting) ? (
          <div className={`shelf-grid ${bulk ? 'bulk-active' : ''}`}>
            {books.map((s, i) => (
              <SeriesCardView
                key={s.id}
                series={s}
                index={i}
                actions={actions(s)}
                selecting={bulk}
                selected={selection.has(s.id!)}
                onSelect={(mods) => selection.click(s.id!, mods)}
                onContextMenu={(e) => menu.open(e, selection.contextTarget(s.id!))}
              />
            ))}
          </div>
        ) : null}
        {list.data?.length ? <p className="collection-note">{t('classic.shelf.note')}</p> : null}

        {menu.state ? (
          <ContextMenu
            x={menu.state.x}
            y={menu.state.y}
            groups={shelfMenu(menu.state.payload)}
            onClose={menu.close}
          />
        ) : null}
        {coverSeries ? (
          <CoverPicker
            series={coverSeries}
            open={!!coverSeries}
            onOpenChange={(open) => !open && setCoverFor(null)}
          />
        ) : null}
      </section>
      <Outlet />
    </div>
  );
}
