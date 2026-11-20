import { Pencil } from 'lucide-react';
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import { usePatchSettings, useSettings } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { Icon } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { toastError } from '../../components/toast';
import { InlineTitle } from '../../components/ui';
import { BookMenuButton, Parchment, StarButton } from './Showcase';
import {
  SHELF_FILTERS,
  SHELF_SORTS,
  shelfDay,
  type ShelfFilter,
  type ShelfQuery,
  type ShelfSort,
  type ShelfState,
} from './shelf';

export type Counts = Record<Exclude<ShelfFilter, 'all'>, number>;

export function FilterBar(props: {
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

export function SeriesCardView(props: {
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
export function CollectionTitle() {
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

export function SkeletonGrid() {
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
