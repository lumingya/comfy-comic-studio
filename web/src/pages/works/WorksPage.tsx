import {
  Download,
  FolderInput,
  ImageIcon,
  Pencil,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl, data as unwrap, download } from '../../api/client';
import { useCreateSeries, useSeriesList, useTrashSeries } from '../../api/series';
import { useImportBundle, usePatchSettings, useSettings } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import { useUndoTrash } from '../../components/undo';
import {
  ActionMenu,
  Empty,
  Field,
  FilePick,
  InlineTitle,
  Modal,
  TextInput,
  type MenuAction,
} from '../../components/ui';
import { CoverPicker } from './CoverPicker';
import { Parchment, Showcase, ShowcaseNav, StarButton } from './Showcase';
import { WorksHero } from './WorksHero';

const STATUSES = ['draft', 'active', 'archived'] as const;
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

function SeriesCardView(props: { series: SeriesCard; index: number; actions: MenuAction[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { series } = props;
  const status = series.status ?? 'draft';
  const date = (series.updated_at ?? '').slice(5, 10).replace('-', '.');
  return (
    <article
      className="shelf-item"
      style={{ '--i': props.index } as CSSProperties}
      aria-label={series.title}
    >
      <button
        className="shelf-cover book-cover"
        style={{ '--cover-ratio': 0.75, '--cover-fit': 'cover' } as CSSProperties}
        data-cover-mode="grid"
        aria-label={series.title}
        onClick={() => navigate(`/series/${series.id}`)}
      >
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

function NewSeriesDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateSeries();
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const studio = useUI((s) => s.studioMode);
  const [starting, setStarting] = useState(false);
  // Classic mode drops you straight into the first panel's prompt (series → "Episode 1" → one
  // empty panel); Studio mode opens the bible first, as a production would.
  const firstPanel = async (seriesId: string) => {
    const episode = unwrap(
      await api.POST('/api/series/{series_id}/episodes', {
        params: { path: { series_id: seriesId } },
        body: { title: t('series.episodeNo', { n: 1 }), synopsis: '' },
      }),
    );
    unwrap(
      await api.POST('/api/episodes/{episode_id}/panels', {
        params: { path: { episode_id: episode.id! } },
        body: { panel: {}, after: null },
      }),
    );
    return episode.id!;
  };
  const submit = () => {
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), subtitle: subtitle.trim() },
      {
        onSuccess: async (s) => {
          const done = (to: string) => {
            props.onOpenChange(false);
            setTitle('');
            setSubtitle('');
            setStarting(false);
            navigate(to);
          };
          if (studio) return done(`/series/${s.id}/bible`);
          setStarting(true);
          try {
            done(`/workshop/${await firstPanel(s.id!)}/script`);
          } catch (error) {
            toastError(error);
            done(`/series/${s.id}`);
          }
        },
        onError: toastError,
      },
    );
  };
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('works.newSeries')}
      description={studio ? undefined : t('classic.works.newHint')}
      footer={
        <>
          <button className="btn ghost" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!title.trim() || create.isPending || starting}
            onClick={submit}
          >
            {studio ? t('common.create') : t('classic.works.createAndStart')}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Field label={t('common.title')}>
          <TextInput
            autoFocus
            value={title}
            onChange={setTitle}
            placeholder={t('works.titlePlaceholder')}
            onEnter={submit}
          />
        </Field>
        <Field label={t('works.subtitle')}>
          <TextInput value={subtitle} onChange={setSubtitle} onEnter={submit} />
        </Field>
      </div>
    </Modal>
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
  const filtering = !!(filter.q || filter.status || starredOnly);
  const view = useUI((s) => s.worksView);
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
  const [creating, setCreating] = useState(false);
  // `?new=1` (home 「从一幕开始」, the command palette) opens the create dialog.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    setCreating(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const onBundle = (file: File) =>
    importBundle.mutate(file, {
      onSuccess: (r) => {
        toast(t('works.imported', { count: 1 }));
        navigate(`/series/${r.series_id}`);
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
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {t('works.newSeries')}
            </button>
          </div>
        </div>

        {list.isLoading ? <SkeletonGrid /> : null}
        {list.error ? <QueryError error={list.error} onRetry={list.refetch} /> : null}
        {list.data && !list.data.length ? (
          <WorksHero
            onCreate={() => setCreating(true)}
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
          />
        ) : null}
        {list.data?.length ? (
          <div className="shelf-index">
            <span>{t('classic.shelf.count', { count: books.length })}</span>
            {view === 'showcase' && books.length ? (
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
        {books.length && view === 'showcase' ? (
          <Showcase
            books={books}
            index={index}
            onIndex={setFeatured}
            firstEditionId={firstEditionId}
            actions={actions}
            onChangeCover={(s) => setCoverFor(s.id!)}
          />
        ) : null}
        {books.length && view === 'grid' ? (
          <div className="shelf-grid">
            {books.map((s, i) => (
              <SeriesCardView key={s.id} series={s} index={i} actions={actions(s)} />
            ))}
            {!filtering ? (
              <article className="shelf-item shelf-new">
                <button className="shelf-cover" onClick={() => setCreating(true)}>
                  <span className="work-new-inner">
                    <Sparkles size={22} />
                    <span>{t('works.newSeries')}</span>
                  </span>
                </button>
              </article>
            ) : null}
          </div>
        ) : null}
        {list.data?.length ? <p className="collection-note">{t('classic.shelf.note')}</p> : null}

        {coverSeries ? (
          <CoverPicker
            series={coverSeries}
            open={!!coverSeries}
            onOpenChange={(open) => !open && setCoverFor(null)}
          />
        ) : null}
        <NewSeriesDialog open={creating} onOpenChange={setCreating} />
      </section>
    </div>
  );
}
