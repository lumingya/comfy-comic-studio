import { FolderInput, Pencil, Search, Star } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { BulkBar, useBulkActions } from './BulkBar';
import { useTranslation } from 'react-i18next';
import { Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { assetUrl, download } from '../../api/client';
import { useSeriesList } from '../../api/series';
import { useImportBundle, usePatchSettings, useSettings } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { useSelection } from '../../app/selection';
import { gallerySearch } from '../../app/navigation';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { ContextMenu, useContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { Empty, FilePick, InlineTitle } from '../../components/ui';
import { CoverPicker } from './CoverPicker';
import { BookMenuButton, Parchment, Showcase, ShowcaseNav, StarButton } from './Showcase';
import { ExportBooks, RenameBooks } from './ShelfDialogs';
import {
  filterShelf,
  missingOf,
  reorderShelf,
  shelfDay,
  shelfState,
  SHELF_FILTERS,
  SHELF_SORTS,
  useGeneratingSeries,
  useResumeSeries,
  type ShelfFilter,
  type ShelfQuery,
  type ShelfSort,
  type ShelfState,
} from './shelf';
import { WorksHero } from './WorksHero';
import { useShelfReorder } from './useShelfReorder';
import { useShelfSelection, type ShelfContext } from './useShelfSelection';

/** Legacy key: the one-line multi-select hint stays hidden once used or dismissed. */
const HINT_KEY = 'cc-hint-multiselect';
type Counts = Record<Exclude<ShelfFilter, 'all'>, number>;

function FilterBar(props: {
  counts: Counts;
  filter: ShelfQuery;
  onChange: (patch: Partial<ShelfQuery>) => void;
  bulk: boolean;
  touch: boolean;
  onBulk: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const view = useUI((s) => s.worksView);
  const setView = useUI((s) => s.setWorksView);
  const starredOnly = props.filter.filter === 'starred';
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
        className={`filter-link ${starredOnly ? 'active' : ''}`}
        aria-pressed={starredOnly}
        onClick={() => props.onChange({ filter: starredOnly ? 'all' : 'starred' })}
      >
        <Icon name="star" sm className={starredOnly ? 'is-filled' : ''} />
        {t('classic.shelf.starred')}
      </button>
      {props.touch ? (
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
      ) : null}
      <select
        id="gallery-filter"
        aria-label={t('classic.shelf.filterLabel')}
        value={props.filter.filter}
        onChange={(e) => props.onChange({ filter: e.target.value as ShelfFilter })}
      >
        {SHELF_FILTERS.map((f) =>
          f === 'all' ? (
            <option key={f} value={f}>
              {t('legacy.allAlbums')}
            </option>
          ) : (
            <option key={f} value={f}>
              {t(`classic.shelf.filter.${f}`)} · {props.counts[f]}
            </option>
          ),
        )}
      </select>
      <select
        id="gallery-sort"
        aria-label={t('classic.shelf.sortLabel')}
        value={props.filter.sort}
        onChange={(e) => props.onChange({ sort: e.target.value as ShelfSort })}
      >
        {SHELF_SORTS.map((v) => (
          <option key={v} value={v}>
            {t(`classic.shelf.sort.${v}`)}
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

function SeriesCardView(props: {
  series: SeriesCard;
  index: number;
  state: ShelfState;
  onMenu: (e: MouseEvent<HTMLButtonElement>) => void;
  /** The ⠿ handle's drag start; absent while dragging would make no sense (one album, selecting). */
  onReorder?: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Touch 批量管理 mode: the cover toggles selection instead of opening the reader. */
  selecting?: boolean;
  selected?: boolean;
  context?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { series } = props;
  return (
    <article
      className={`shelf-item ${props.selecting ? 'is-selecting' : ''} ${props.selected ? 'is-selected' : ''} ${props.context ? 'is-context' : ''}`}
      style={{ '--i': props.index } as CSSProperties}
      aria-label={series.title}
      aria-selected={props.selected || undefined}
      data-shelf-id={series.id}
      tabIndex={0}
    >
      {props.onReorder ? (
        <span
          className="shelf-drag-handle"
          data-reorder-handle
          title={t('classic.shelf.dragHandle')}
          aria-hidden
          onPointerDown={props.onReorder}
        >
          ⠿
        </span>
      ) : null}
      <button
        className="shelf-cover book-cover"
        style={{ '--cover-ratio': 0.75, '--cover-fit': 'cover' } as CSSProperties}
        data-cover-mode="grid"
        aria-label={series.title}
        aria-pressed={props.selecting ? !!props.selected : undefined}
        type="button"
        data-shelf-open
      >
        {props.selecting ? (
          <span className="bulk-check" aria-hidden>
            {props.selected ? <Icon name="check" sm /> : null}
          </span>
        ) : null}
        {series.cover_asset_id ? (
          <img
            draggable={false}
            src={assetUrl(series.cover_asset_id, 640)}
            alt={series.title}
            loading="lazy"
          />
        ) : (
          <Parchment series={series} />
        )}
        <span className="cover-paper" aria-hidden />
        <span className="pic-count">▧ {series.adopted_count ?? 0}</span>
      </button>
      <div className="edition-tile-footer">
        <h3>{series.title}</h3>
        <StarButton series={series} small />
        <BookMenuButton label={t('classic.shelf.menu')} onMenu={props.onMenu} />
      </div>
      <div className="edition-tile-meta">
        <span>{t('classic.shelf.frames', { count: series.panel_count ?? 0 })}</span>
        <span className={`status-label is-${props.state}`}>
          {t(`classic.shelf.state.${props.state}`)}
        </span>
        <time dateTime={series.created_at}>{shelfDay(series.created_at, i18n.language)}</time>
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
        onSave={(collection_title) =>
          patch.mutateAsync({ collection_title }, { onError: toastError })
        }
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
  const items = useMemo(() => list.data ?? [], [list.data]);
  const sort = useUI((s) => s.shelfSort);
  const setSort = useUI((s) => s.setShelfSort);
  const order = useUI((s) => s.shelfOrder);
  const setOrder = useUI((s) => s.setShelfOrder);
  const starred = useUI((s) => s.starred);
  const generating = useGeneratingSeries(items);
  const generatingKey = [...generating].sort().join(',');
  // Search and status live in the URL so Back returns to the same view; the sort is remembered.
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const filter: ShelfQuery = {
    q: params.get('q') ?? '',
    // ?starred=1 is the old link to the starred shelf.
    filter:
      params.get('starred') === '1'
        ? 'starred'
        : (SHELF_FILTERS as readonly string[]).includes(status)
          ? (status as ShelfFilter)
          : 'all',
    sort,
  };
  const setFilter = (patch: Partial<ShelfQuery>) => {
    if (patch.sort) setSort(patch.sort);
    const next = { ...filter, ...patch };
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.filter !== 'all') p.set('status', next.filter);
    setParams(p, { replace: true });
  };
  const books = useMemo(
    () => filterShelf(items, filter, { starred, generating, order }, i18n.language),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filter.q, filter.filter, sort, starred, generatingKey, order, i18n.language],
  );
  const counts = useMemo<Counts>(
    () => ({
      complete: items.filter((s) => shelfState(s, generating.has(s.id!)) === 'complete').length,
      generating: items.filter((s) => generating.has(s.id!)).length,
      failed: items.filter((s) => missingOf(s) > 0).length,
      starred: items.filter((s) => starred.includes(s.id!)).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, starred, generatingKey],
  );
  const stateOf = (s: SeriesCard) => shelfState(s, generating.has(s.id!));
  const view = useUI((s) => s.worksView);
  const readerOpen = !!useMatch('/gallery/:seriesId/*');
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SeriesCard[] | null>(null);
  const [exporting, setExporting] = useState<SeriesCard[] | null>(null);
  // Multi-select (legacy desktop selection): Ctrl / ⌘ / Shift + click, right-click for batch
  // actions, Ctrl+A / Esc / Delete. 批量管理 is the touch fallback that makes a tap select.
  const [bulk, setBulk] = useState(false);
  const bookIds = useMemo(() => books.map((b) => b.id!), [books]);
  const selection = useSelection(bookIds);
  const showGrid = view === 'grid' || bulk;
  const bulkActions = useBulkActions(() => selection.clear());
  const menu = useContextMenu<ShelfContext>();
  const dialogOpen = !!coverFor || !!renaming || !!exporting;
  const setBulkMode = (on: boolean) => {
    setBulk(on);
    selection.clear();
  };
  const shelf = useShelfSelection({
    selection,
    enabled: !readerOpen && !dialogOpen,
    pinned: bulk,
    contextOpen: !!menu.state,
    onExit: () => setBulkMode(false),
    onOpen: (id) => navigate(`/gallery/${id}${gallerySearch(params)}`),
    onDelete: (ids) => {
      if (!bulkActions.busy) void bulkActions.remove(books.filter((b) => ids.includes(b.id!)));
    },
    onContext: menu.openAt,
    onCloseContext: menu.close,
  });
  const visibleSelection = shelf.snapshot ?? selection.ids;
  const chosen = books.filter((b) => visibleSelection.includes(b.id!));
  /** Legacy reorderCollectionBook: the drop becomes the manual order (and 手动排序 the sort). */
  const moveBook = (source: string, target: string, after: boolean) => {
    setOrder(reorderShelf(items, bookIds, order, sort, source, target, after));
    setSort('manual');
    toast(t('classic.shelf.reordered'));
  };
  const reorder = useShelfReorder({
    root: shelf.ref,
    enabled: !readerOpen && !dialogOpen && !bulk && !selection.ids.length && books.length > 1,
    onDrop: moveBook,
  });
  useEffect(() => {
    menu.close();
  }, [view, filter.q, filter.filter, sort, menu.close]);
  useEffect(() => {
    if (menu.state?.payload.ids.some((id) => !bookIds.includes(id))) menu.close();
  }, [bookIds, menu.state, menu.close]);
  const [hintSeen, setHintSeen] = useState(() => localStorage.getItem(HINT_KEY) === 'seen');
  const seeHint = () => {
    localStorage.setItem(HINT_KEY, 'seen');
    setHintSeen(true);
  };
  useEffect(() => {
    if (selection.ids.length > 1 && !hintSeen && shelf.snapshot === null) seeHint();
  });
  // The featured book (showcase); back to the first one whenever the filter changes.
  const [featured, setFeatured] = useState(0);
  const filterKey = `${filter.q}|${filter.filter}|${sort}`;
  useEffect(() => setFeatured(0), [filterKey]);
  const index = Math.min(featured, Math.max(0, books.length - 1));
  const firstEditionId = useMemo(
    () => [...items].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))[0]?.id,
    [items],
  );
  const coverSeries = items.find((s) => s.id === coverFor);
  const settings = useSettings();
  const collectionTitle = settings.data?.collection_title || t('classic.shelf.defaultTitle');
  const importBundle = useImportBundle();
  // 画册集 is for reading; a new album starts in 创作工坊 (装配 → 新建生成任务).
  const create = () => navigate('/workshop/assembly?new=1');
  useEffect(() => {
    if (params.get('new') === '1') navigate('/workshop/assembly?new=1', { replace: true });
  }, [params, navigate]);

  // 补齐缺失分幕: only scenes without an album image run, one candidate each, adopted as they land.
  const resumeSeries = useResumeSeries();
  const [resuming, setResuming] = useState<string[]>([]);
  const resume = async (targets: SeriesCard[]) => {
    const todo = targets.filter((b) => missingOf(b) > 0 && !generating.has(b.id!));
    if (!todo.length) {
      toast(
        t(
          targets.some((b) => generating.has(b.id!))
            ? 'classic.shelf.resumeBusy'
            : 'classic.shelf.resumeNone',
        ),
      );
      return;
    }
    const ids = todo.map((b) => b.id!);
    setResuming((r) => [...r, ...ids]);
    let queued = 0;
    try {
      for (const b of todo) queued += await resumeSeries(b);
      toast(queued ? t('classic.shelf.resumed', { count: queued }) : t('classic.shelf.resumeNone'));
    } catch (e) {
      toastError(e);
    } finally {
      setResuming((r) => r.filter((id) => !ids.includes(id)));
    }
  };
  const open = (id: string) => {
    setBulkMode(false);
    selection.anchorAt(id);
    navigate(`/gallery/${id}${gallerySearch(params)}`);
  };
  /** ⋯ opens the right-click menu under the button (legacy book-menu on the shelf). */
  const openMenu = (series: SeriesCard, e: MouseEvent<HTMLButtonElement>) => {
    const target = e.currentTarget,
      rect = target.getBoundingClientRect(),
      id = series.id!;
    const multi = selection.has(id) && selection.ids.length > 1;
    if (!multi && selection.ids.length) selection.clear();
    menu.openAt(rect.left, rect.bottom + 4, {
      ids: multi ? selection.ids : [id],
      focusId: id,
      target,
    });
  };

  /** Legacy singleBookContextItems / multiBookContextItems. */
  const shelfMenu = (ids: string[], focusId?: string): ContextGroup[] => {
    const targets = books.filter((b) => ids.includes(b.id!));
    const starredAll = bulkActions.allStarred(targets);
    const selectAll = {
      label: t('classic.shelf.selectFiltered'),
      icon: <Icon name="check" sm />,
      shortcut: 'Ctrl/⌘ A',
      onSelect: () => {
        selection.all();
        shelf.ref.current?.focus({ preventScroll: true });
      },
    };
    if (targets.length > 1) {
      const focus = targets.find((b) => b.id === focusId);
      return [
        {
          heading: t('classic.shelf.forSelection', { count: targets.length }),
          items: [
            {
              label: t(starredAll ? 'classic.shelf.unstarMany' : 'classic.shelf.starMany'),
              icon: <Icon name="star" sm />,
              onSelect: () => bulkActions.star(targets),
            },
            {
              label: t('classic.shelf.renameMulti'),
              icon: <Icon name="edit" sm />,
              onSelect: () => setRenaming(targets),
            },
            {
              label: t('classic.shelf.exportOffline'),
              icon: <Icon name="download" sm />,
              hint: t('classic.shelf.exportOfflineMultiHint'),
              onSelect: () => setExporting(targets),
            },
            {
              label: t('classic.shelf.shareSource'),
              icon: <Icon name="upload" sm />,
              hint: t('classic.shelf.bulkExportHint'),
              disabled: bulkActions.busy,
              onSelect: () => void bulkActions.exportAll(targets),
            },
            {
              label: t('classic.shelf.resumeMenu'),
              icon: <Icon name="refresh" sm />,
              hint: t('classic.shelf.resumeMultiHint'),
              disabled: !targets.some((b) => missingOf(b) > 0),
              onSelect: () => void resume(targets),
            },
          ],
        },
        {
          items: [
            ...(focus
              ? [
                  {
                    label: t('classic.shelf.openOnly'),
                    icon: <Icon name="book" sm />,
                    hint: focus.title,
                    onSelect: () => open(focus.id!),
                  },
                ]
              : []),
            selectAll,
            {
              label: t('classic.shelf.clearSelection'),
              icon: <Icon name="close" sm />,
              shortcut: 'Esc',
              onSelect: () => setBulkMode(false),
            },
          ],
        },
        {
          items: [
            {
              label: t('classic.shelf.deleteMany'),
              icon: <Icon name="trash" sm />,
              danger: true,
              shortcut: 'Del',
              disabled: bulkActions.busy,
              onSelect: () => void bulkActions.remove(targets),
            },
          ],
        },
      ];
    }
    const one = targets[0];
    if (!one) return [];
    const id = one.id!,
      at = bookIds.indexOf(id),
      missing = missingOf(one),
      busy = generating.has(id);
    return [
      {
        items: [
          {
            label: t('classic.shelf.open'),
            icon: <Icon name="book" sm />,
            primary: true,
            shortcut: 'Enter',
            onSelect: () => open(id),
          },
          {
            label: starredAll ? t('classic.shelf.unstar') : t('classic.shelf.star'),
            icon: <Icon name="star" sm />,
            onSelect: () => bulkActions.star(targets),
          },
          {
            label: t('classic.shelf.renameMenu'),
            icon: <Icon name="edit" sm />,
            onSelect: () => setRenaming(targets),
          },
          {
            label: t('classic.shelf.resumeMenu'),
            icon: <Icon name="refresh" sm />,
            disabled: !missing || busy || resuming.includes(id),
            hint: busy
              ? t('classic.shelf.resumeBusy')
              : missing
                ? t('classic.shelf.resumeHint', { count: missing })
                : t('classic.shelf.resumeNone'),
            onSelect: () => void resume(targets),
          },
          {
            label: t('classic.shelf.changeCover'),
            icon: <Icon name="image" sm />,
            onSelect: () => setCoverFor(id),
          },
        ],
      },
      {
        heading: t('classic.shelf.exportGroup'),
        items: [
          {
            label: t('classic.shelf.exportOffline'),
            icon: <Icon name="download" sm />,
            hint: t('classic.shelf.exportOfflineHint'),
            onSelect: () => navigate(`/gallery/${id}/export${gallerySearch(params)}`),
          },
          {
            label: t('classic.shelf.shareSource'),
            icon: <Icon name="upload" sm />,
            hint: t('classic.shelf.shareSourceHint'),
            onSelect: () =>
              void download(`/api/series/${id}/bundle`, `${one.title}.mio.zip`).catch(toastError),
          },
        ],
      },
      {
        heading: t('classic.shelf.organize'),
        items: [
          {
            label: t('classic.shelf.moveUp'),
            icon: <Icon name="up" sm />,
            disabled: at <= 0,
            onSelect: () => moveBook(id, bookIds[at - 1], false),
          },
          {
            label: t('classic.shelf.moveDown'),
            icon: <Icon name="down" sm />,
            disabled: at < 0 || at >= bookIds.length - 1,
            onSelect: () => moveBook(id, bookIds[at + 1], true),
          },
          { ...selectAll, hint: t('classic.shelf.selectFilteredHint') },
        ],
      },
      {
        items: [
          {
            label: t('classic.shelf.deleteOne'),
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
  /** Legacy ctx-title / subtitle: the album and its facts, or the size of the selection. */
  const menuHead = (ids: string[]) => {
    if (ids.length > 1)
      return {
        title: t('classic.shelf.selectedTitle', { count: ids.length }),
        subtitle: t('classic.shelf.multiSubtitle'),
      };
    const one = books.find((b) => b.id === ids[0]);
    if (!one) return {};
    const missing = missingOf(one);
    const cast = (one.bible?.characters ?? [])
      .map((c) => c.name)
      .filter(Boolean)
      .slice(0, 2)
      .join('、');
    return {
      title: one.title,
      subtitle: [
        t('classic.shelf.frames', { count: one.panel_count ?? 0 }),
        cast,
        missing ? t('classic.shelf.missingShort', { count: missing }) : t('classic.shelf.ready'),
      ]
        .filter(Boolean)
        .join(' · '),
    };
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
            <FilePick accept=".zip" onFile={onBundle} disabled={importBundle.isPending}>
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
              <FilePick accept=".zip" onFile={onBundle}>
                <FolderInput size={15} /> {t('works.importBundle')}
              </FilePick>
            }
          />
        ) : null}
        {list.data?.length ? (
          <FilterBar
            counts={counts}
            filter={filter}
            onChange={setFilter}
            bulk={bulk}
            touch={shelf.touch}
            onBulk={setBulkMode}
          />
        ) : null}
        <div
          id="gallery-results"
          ref={shelf.ref}
          tabIndex={0}
          role="region"
          aria-label={t('classic.shelf.listLabel')}
          className={selection.ids.length ? 'has-selection' : undefined}
          onClickCapture={shelf.onClickCapture}
          onPointerDown={shelf.onPointerDown}
          onDragStartCapture={shelf.onDragStartCapture}
          onContextMenu={shelf.onContextMenu}
        >
          {list.data?.length ? (
            <div className="shelf-index">
              <span>{t('classic.shelf.count', { count: books.length })}</span>
              {view === 'showcase' && !showGrid && books.length ? (
                <ShowcaseNav index={index} total={books.length} onIndex={setFeatured} />
              ) : null}
            </div>
          ) : null}
          {list.data?.length && !books.length ? (
            <Empty
              compact
              icon={filter.filter === 'starred' ? <Star size={20} /> : <Search size={20} />}
              title={
                filter.filter === 'starred' && !filter.q
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
          {(bulk || chosen.length > 0) && books.length ? (
            <BulkBar
              books={books}
              chosen={chosen}
              actions={bulkActions}
              onAll={selection.all}
              onNone={selection.clear}
              onExit={() => setBulkMode(false)}
              pinned={bulk}
              onMore={(event) => {
                const target = event.currentTarget,
                  rect = target.getBoundingClientRect();
                menu.openAt(rect.left, rect.bottom + 4, { ids: selection.ids, target });
              }}
            />
          ) : null}
          {books.length && view === 'showcase' && !showGrid ? (
            <Showcase
              books={books}
              index={index}
              onIndex={setFeatured}
              firstEditionId={firstEditionId}
              stateOf={stateOf}
              onMenu={openMenu}
              onResume={(s) => void resume([s])}
              resuming={!!books[index] && resuming.includes(books[index].id!)}
              onChangeCover={(s) => setCoverFor(s.id!)}
              selected={!!books[index] && selection.has(books[index].id!)}
              context={menu.state?.payload.focusId === books[index]?.id}
              disabled={readerOpen || dialogOpen}
            />
          ) : null}
          {books.length > 1 && !bulk && !chosen.length && !shelf.touch && !hintSeen ? (
            <p className="multiselect-hint">
              <span>{t('classic.shelf.multiHint')}</span>
              <button type="button" className="link-button" onClick={seeHint}>
                {t('classic.shelf.multiHintOk')}
              </button>
            </p>
          ) : null}
          {books.length && showGrid ? (
            <div className={`shelf-grid ${bulk ? 'bulk-active' : ''}`}>
              {books.map((s, i) => (
                <SeriesCardView
                  key={s.id}
                  series={s}
                  index={i}
                  state={stateOf(s)}
                  onMenu={(e) => openMenu(s, e)}
                  onReorder={books.length > 1 && !bulk ? reorder.onPointerDown : undefined}
                  selecting={bulk}
                  selected={selection.has(s.id!)}
                  context={menu.state?.payload.focusId === s.id}
                />
              ))}
            </div>
          ) : null}
          {list.data?.length ? <p className="collection-note">{t('classic.shelf.note')}</p> : null}
        </div>
        {menu.state ? (
          <ContextMenu
            x={menu.state.x}
            y={menu.state.y}
            {...menuHead(menu.state.payload.ids)}
            groups={shelfMenu(menu.state.payload.ids, menu.state.payload.focusId)}
            returnFocus={menu.state.payload.target}
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
        {renaming ? (
          <RenameBooks books={renaming} open onOpenChange={(open) => !open && setRenaming(null)} />
        ) : null}
        {exporting ? (
          <ExportBooks
            books={exporting}
            open
            collectionTitle={collectionTitle}
            onOpenChange={(open) => !open && setExporting(null)}
          />
        ) : null}
      </section>
      <Outlet />
    </div>
  );
}
