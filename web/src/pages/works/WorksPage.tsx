import { Archive, Download, FolderInput, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl, data as unwrap, download } from '../../api/client';
import { useCreateSeries, useSeriesList, useTrashSeries } from '../../api/series';
import { useImportBundle } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { QueryError } from '../../app/errors';
import { relativeTime } from '../../app/format';
import { usePageTitle } from '../../app/title';
import { useUI } from '../../app/ui-store';
import { Avatar } from '../../components/avatar';
import { toast, toastError } from '../../components/toast';
import { useUndoTrash } from '../../components/undo';
import { ActionMenu, Empty, Field, FilePick, Modal, Select, TextInput } from '../../components/ui';
import { WorksHero } from './WorksHero';
import { LegacyImportDialog } from './LegacyImportDialog';

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
}) {
  const { t } = useTranslation();
  const counts = useMemo(() => {
    const c: Record<Status, number> = { draft: 0, active: 0, archived: 0 };
    for (const s of props.items) c[(s.status ?? 'draft') as Status]++;
    return c;
  }, [props.items]);
  return (
    <div className="filter-bar" role="search">
      <label className="filter-search">
        <Search size={15} aria-hidden />
        <input
          className="input"
          type="search"
          value={props.filter.q}
          placeholder={t('works.search')}
          aria-label={t('works.search')}
          onChange={(e) => props.onChange({ q: e.target.value })}
        />
        {props.filter.q ? (
          <button
            type="button"
            className="filter-clear"
            aria-label={t('common.clear')}
            onClick={() => props.onChange({ q: '' })}
          >
            <X size={13} />
          </button>
        ) : null}
      </label>
      <div className="segmented" role="group" aria-label={t('series.statusLabel')}>
        <button
          type="button"
          className={props.filter.status === '' ? 'active' : ''}
          onClick={() => props.onChange({ status: '' })}
        >
          {t('common.all')} <span className="seg-count">{props.items.length}</span>
        </button>
        {STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            className={props.filter.status === st ? 'active' : ''}
            onClick={() => props.onChange({ status: st })}
          >
            {t(`series.status.${st}`)} <span className="seg-count">{counts[st]}</span>
          </button>
        ))}
      </div>
      <Select
        className="filter-sort"
        aria-label={t('works.sortLabel')}
        value={props.filter.sort}
        onChange={(sort) => props.onChange({ sort })}
        options={SORTS.map((v) => ({ value: v, label: t(`works.sort.${v}`) }))}
      />
    </div>
  );
}

function SeriesCardView({ series, index }: { series: SeriesCard; index: number }) {
  const { t, i18n } = useTranslation();
  const trash = useTrashSeries();
  const undo = useUndoTrash();
  const cast = series.bible?.characters ?? [];
  const status = series.status ?? 'draft';
  return (
    <article className="work-card book-card" style={{ '--i': index } as CSSProperties}>
      <Link to={`/series/${series.id}`} className="work-cover book-cover" tabIndex={-1} aria-hidden>
        {series.cover_asset_id ? (
          <img src={assetUrl(series.cover_asset_id, 640)} alt="" loading="lazy" />
        ) : (
          <span className="parchment">
            <span className="parchment-mark">MIO · COLLECTION</span>
            {/* Painted from data-* so the cover does not repeat the title for screen readers. */}
            <span className="parchment-title" data-text={series.title} />
            {series.subtitle ? (
              <span className="parchment-sub" data-text={series.subtitle} />
            ) : null}
            <span className="parchment-rule" />
          </span>
        )}
        <span className="book-spine" />
        <span className={`glass-chip work-status status-${status}`}>
          <i className="dot" /> {t(`series.status.${status}`)}
        </span>
        <span className="book-badge mono">
          {t('works.episodes', { count: series.episode_count ?? 0 })}
        </span>
      </Link>
      <div className="work-body">
        <Link to={`/series/${series.id}`} className="work-title">
          <h3>{series.title}</h3>
        </Link>
        {series.subtitle ? <p className="work-sub">{series.subtitle}</p> : null}
        <div className="work-meta">
          <span>{t('works.characters', { count: cast.length })}</span>
          <span title={series.updated_at}>{relativeTime(series.updated_at, i18n.language)}</span>
        </div>
      </div>
      <footer className="work-foot">
        <div className="work-cast">
          {cast.slice(0, 5).map((c) => (
            <Avatar key={c.id} character={c} size={24} />
          ))}
          {cast.length > 5 ? <span className="avatar more">+{cast.length - 5}</span> : null}
        </div>
        <ActionMenu
          actions={[
            {
              label: t('works.exportBundle'),
              icon: <Download size={14} />,
              onSelect: () =>
                download(`/api/series/${series.id}/bundle`, `${series.title}.mio.zip`).catch(
                  toastError,
                ),
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
          ]}
        />
      </footer>
    </article>
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
            done(`/episodes/${await firstPanel(s.id!)}/script`);
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
    setParams(p, { replace: true });
  };
  const filtered = useMemo(
    () => (list.data ? filterWorks(list.data, filter, i18n.language) : []),
    [list.data, filter.q, filter.status, filter.sort, i18n.language],
  );
  const filtering = !!(filter.q || filter.status);
  const importBundle = useImportBundle();
  const [creating, setCreating] = useState(false);
  const [legacy, setLegacy] = useState(false);
  usePageTitle(t('works.heading'));

  const onBundle = (file: File) =>
    importBundle.mutate(file, {
      onSuccess: (r) => {
        toast(t('works.imported', { count: 1 }));
        navigate(`/series/${r.series_id}`);
      },
      onError: toastError,
    });

  return (
    <div className="page">
      <header className="page-head classic-head">
        <div>
          <div className="eyebrow">{t('classic.works.eyebrow')}</div>
          <h1>{t('works.heading')}</h1>
          <p>{t('works.sub')}</p>
        </div>
        <div className="page-actions">
          <button className="btn ghost" onClick={() => setLegacy(true)}>
            <Archive size={15} /> {t('works.importLegacy')}
          </button>
          <FilePick
            accept=".zip,application/zip"
            onFile={onBundle}
            disabled={importBundle.isPending}
          >
            <FolderInput size={15} /> {t('works.importBundle')}
          </FilePick>
          <button className="btn primary glow" onClick={() => setCreating(true)}>
            <Plus size={15} /> {t('works.newSeries')}
          </button>
        </div>
      </header>

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
        <FilterBar items={list.data} filter={filter} onChange={setFilter} />
      ) : null}
      {list.data?.length && !filtered.length ? (
        <Empty
          compact
          icon={<Search size={20} />}
          title={t('works.noMatch')}
          action={
            <button className="btn" onClick={() => setFilter({ q: '', status: '' })}>
              {t('works.clearFilters')}
            </button>
          }
        />
      ) : null}
      {filtered.length ? (
        <div className="work-grid">
          {filtered.map((s, i) => (
            <SeriesCardView key={s.id} series={s} index={i} />
          ))}
          {!filtering ? (
            <button
              className="work-card book-card work-new"
              style={{ '--i': filtered.length } as CSSProperties}
              onClick={() => setCreating(true)}
            >
              <span className="work-new-inner">
                <Sparkles size={22} />
                <span>{t('works.newSeries')}</span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <NewSeriesDialog open={creating} onOpenChange={setCreating} />
      <LegacyImportDialog open={legacy} onOpenChange={setLegacy} />
    </div>
  );
}
