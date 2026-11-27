import { Search, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { BulkBar, useBulkActions } from './BulkBar';
import { useTranslation } from 'react-i18next';
import { Outlet, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { useSeriesList } from '../../api/series';
import { useImportBundle, useSettings } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { useSelection } from '../../app/selection';
import { gallerySearch } from '../../app/navigation';
import { useUI } from '../../app/ui-store';
import { ContextMenu, useContextMenu } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { Empty } from '../../components/ui';
import { CreationKitImport } from '../workshop/CreationKitImport';
import { CoverPicker } from './CoverPicker';
import { AlbumHtmlImport } from './AlbumHtmlImport';
import { CollectionTabs } from './CollectionTabs';
import { CollectionMoveMenu } from './CollectionMoveMenu';
import { Showcase, ShowcaseNav } from './Showcase';
import { ExportBooks, RenameBooks } from './ShelfDialogs';
import {
  filterShelf,
  missingOf,
  reorderShelfMany,
  shelfState,
  SHELF_FILTERS,
  useGeneratingSeries,
  type ShelfFilter,
  type ShelfQuery,
} from './shelf';
import { WorksHero } from './WorksHero';
import { useShelfReorder } from './useShelfReorder';
import { booksInCollection, useShelfCollections } from './useShelfCollections';
import { useShelfSelection, type ShelfContext } from './useShelfSelection';
import {
  CollectionTitle,
  FilterBar,
  SeriesCardView,
  SkeletonGrid,
  type Counts,
} from './WorksShelfParts';
import { useWorksActions } from './worksActions';
import './works-copy.css';

/** Legacy key: the one-line multi-select hint stays hidden once used or dismissed. */
const HINT_KEY = 'cc-hint-multiselect';
let shelfReorderRevision = 0;

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
  const collection = params.get('collection') ?? '';
  const setCollection = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('collection', value);
    else next.delete('collection');
    setParams(next, { replace: true });
  };
  const collections = useShelfCollections(items, collection, () => setCollection(''));
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
    const p = new URLSearchParams(params);
    p.delete('q');
    p.delete('status');
    p.delete('starred');
    if (next.q) p.set('q', next.q);
    if (next.filter !== 'all') p.set('status', next.filter);
    setParams(p, { replace: true });
  };
  const books = useMemo(
    () =>
      booksInCollection(
        filterShelf(items, filter, { starred, generating, order }, i18n.language),
        collection,
        collections.query.data,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      items,
      collection,
      collections.query.data,
      filter.q,
      filter.filter,
      sort,
      starred,
      generatingKey,
      order,
      i18n.language,
    ],
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
  const [collectionDialog, setCollectionDialog] = useState(false);
  const [albumImportOpen, setAlbumImportOpen] = useState(false);
  const targetsRoot = useRef<HTMLElement>(null);
  // Multi-select (legacy desktop selection): Ctrl / ⌘ / Shift + click, right-click for batch
  // actions, Ctrl+A / Esc / Delete. 批量管理 is the touch fallback that makes a tap select.
  const [bulk, setBulk] = useState(false);
  const bookIds = useMemo(() => books.map((b) => b.id!), [books]);
  const selection = useSelection(bookIds);
  const showGrid = view === 'grid' || bulk;
  const bulkActions = useBulkActions(() => selection.clear());
  const menu = useContextMenu<ShelfContext>();
  const dialogOpen = !!coverFor || !!renaming || !!exporting || collectionDialog || albumImportOpen;
  const setBulkMode = (on: boolean) => {
    setBulk(on);
    selection.clear();
  };
  const shelf = useShelfSelection({
    marqueeFromBlankOnly: true,
    escapeFromFields: true,
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
  const visibleSelection = shelf.snapshot ? new Set(shelf.snapshot) : selection.set;
  const chosen = books.filter((b) => visibleSelection.has(b.id!));
  const selectedBookIds = bookIds.filter((id) => selection.has(id));
  /** Legacy reorderCollectionBook: the drop becomes the manual order (and 手动排序 the sort). */
  const moveBook = (source: string, target: string, after: boolean, moving = [source]) => {
    const current = useUI.getState();
    const previous = { order: current.shelfOrder, sort: current.shelfSort };
    const nextOrder = reorderShelfMany(
      items,
      bookIds,
      previous.order,
      previous.sort,
      moving,
      target,
      after,
    );
    const revision = ++shelfReorderRevision;
    setOrder(nextOrder);
    setSort('manual');
    toast(t('classic.shelf.reordered'), {
      action: {
        label: t('common.undo'),
        onClick: () => {
          const latest = useUI.getState();
          const stillCurrent =
            revision === shelfReorderRevision &&
            latest.shelfSort === 'manual' &&
            latest.shelfOrder.length === nextOrder.length &&
            latest.shelfOrder.every((id, index) => id === nextOrder[index]);
          if (!stillCurrent) {
            toast(t('classic.shelf.reorderUndoStale'));
            return;
          }
          ++shelfReorderRevision;
          setOrder(previous.order);
          setSort(previous.sort);
        },
      },
    });
  };
  const reorder = useShelfReorder({
    root: shelf.ref,
    targetsRoot,
    enabled: !readerOpen && !dialogOpen && !menu.state,
    canDrag: !collections.busy,
    sortable: !bulk && books.length > 1,
    selectedIds: selectedBookIds,
    onDrop: moveBook,
    onCollectionDrop: collections.query.data
      ? (ids, target) => void collections.move(ids, target)
      : undefined,
  });
  useEffect(() => {
    menu.close();
  }, [view, collection, filter.q, filter.filter, sort, menu.close]);
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
  const filterKey = `${collection}|${filter.q}|${filter.filter}|${sort}`;
  useEffect(() => setFeatured(0), [filterKey]);
  const index = Math.min(featured, Math.max(0, books.length - 1));
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
  const { resuming, resume, shelfMenu, menuHead } = useWorksActions({
    books,
    generating,
    bulkActions,
    setRenaming,
    setExporting,
    setCoverFor,
    setBulkMode,
    onExport: (id) => navigate(`/gallery/${id}/export${gallerySearch(params)}`),
  });
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
      <section
        className="art-fade"
        id="collection-home"
        ref={targetsRoot}
        onPointerDownCapture={reorder.onPointerDownCapture}
        onClickCapture={reorder.onClickCapture}
      >
        <div className="collection-heading">
          <div className="grow">
            <CollectionTitle
              onCancel={() => {
                if (!dialogOpen && !menu.state && !readerOpen && (bulk || selection.ids.length)) {
                  setBulkMode(false);
                }
              }}
            />
          </div>
          <div className="resource-actions">
            <AlbumHtmlImport onDialogChange={setAlbumImportOpen} />
            <CreationKitImport
              label={t('works.importBundle')}
              legacyLabel={t('works.importBundle')}
              legacyAccept=".zip"
              onLegacyFile={onBundle}
              disabled={importBundle.isPending}
            />
            <button className="btn primary" onClick={create}>
              <Icon name="plus" />
              {t('works.newSeries')}
            </button>
          </div>
        </div>

        <CollectionTabs
          index={collections.query.data}
          value={collection}
          onChange={setCollection}
          busy={collections.busy}
          onCreate={collections.create}
          onRename={collections.rename}
          onDelete={collections.remove}
          onDialogChange={setCollectionDialog}
        />
        {collections.query.error ? (
          <QueryError error={collections.query.error} onRetry={collections.query.refetch} />
        ) : null}

        {list.isLoading ? <SkeletonGrid /> : null}
        {list.error ? <QueryError error={list.error} onRetry={list.refetch} /> : null}
        {list.data && !list.data.length ? (
          <WorksHero
            onCreate={create}
            importAction={
              <CreationKitImport
                label={t('works.importBundle')}
                legacyLabel={t('works.importBundle')}
                legacyAccept=".zip"
                onLegacyFile={onBundle}
                disabled={importBundle.isPending}
              />
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
          onClickCapture={(e) => {
            if (!e.defaultPrevented) shelf.onClickCapture(e);
          }}
          onKeyDown={reorder.onKeyDown}
          onBlurCapture={reorder.onBlurCapture}
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
              onExport={() => setExporting(chosen)}
              moveAction={
                <CollectionMoveMenu
                  index={collections.query.data}
                  disabled={!chosen.length || collections.busy}
                  onMove={(target) =>
                    void collections.move(
                      chosen.map((book) => book.id!),
                      target,
                    )
                  }
                />
              }
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
              stateOf={stateOf}
              onMenu={openMenu}
              onResume={(s) => void resume([s])}
              resuming={!!books[index] && resuming.includes(books[index].id!)}
              onChangeCover={(s) => setCoverFor(s.id!)}
              selected={!!books[index] && selection.has(books[index].id!)}
              context={menu.state?.payload.focusId === books[index]?.id}
              disabled={readerOpen || dialogOpen}
              onPointerDown={reorder.onPointerDown}
              readerSearch={gallerySearch(params)}
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
                  onPointerDown={reorder.onPointerDown}
                  sortable={
                    !collections.busy && (!!collections.query.data || (!bulk && books.length > 1))
                  }
                  selecting={bulk}
                  selected={selection.has(s.id!)}
                  context={menu.state?.payload.focusId === s.id}
                />
              ))}
            </div>
          ) : null}
        </div>
        {menu.state ? (
          <ContextMenu
            x={menu.state.x}
            y={menu.state.y}
            {...menuHead(menu.state.payload.ids)}
            groups={shelfMenu(menu.state.payload.ids)}
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
