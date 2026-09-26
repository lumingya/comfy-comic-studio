import { Archive, BookOpen, Download, FolderInput, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { assetUrl, download } from '../../api/client';
import { useCreateSeries, useSeriesList, useTrashSeries } from '../../api/series';
import { useImportBundle } from '../../api/system';
import type { SeriesCard } from '../../api/types';
import { QueryError } from '../../app/errors';
import { relativeTime } from '../../app/format';
import { usePageTitle } from '../../app/title';
import { Avatar } from '../../components/avatar';
import { toast, toastError } from '../../components/toast';
import { useUndoTrash } from '../../components/undo';
import { ActionMenu, Empty, Field, FilePick, Modal, Select, TextInput } from '../../components/ui';
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

function SeriesCardView({ series }: { series: SeriesCard }) {
  const { t, i18n } = useTranslation();
  const trash = useTrashSeries();
  const undo = useUndoTrash();
  const cast = series.bible?.characters ?? [];
  const status = series.status ?? 'draft';
  return (
    <article className="work-card">
      <Link to={`/series/${series.id}`} className="work-cover" tabIndex={-1} aria-hidden>
        {series.cover_asset_id ? (
          <img src={assetUrl(series.cover_asset_id, 640)} alt="" loading="lazy" />
        ) : (
          <span className="work-cover-mark">{series.title.slice(0, 1)}</span>
        )}
        <span className={`chip work-status status-${status}`}>{t(`series.status.${status}`)}</span>
      </Link>
      <div className="work-body">
        <Link to={`/series/${series.id}`} className="work-title">
          <h3>{series.title}</h3>
        </Link>
        {series.subtitle ? <p className="work-sub">{series.subtitle}</p> : null}
        <div className="work-meta">
          <span>{t('works.episodes', { count: series.episode_count ?? 0 })}</span>
          <span>{t('works.characters', { count: cast.length })}</span>
          <span title={series.updated_at}>{relativeTime(series.updated_at, i18n.language)}</span>
        </div>
      </div>
      <footer className="work-foot">
        <div className="work-cast">
          {cast.slice(0, 5).map((c) => (
            <Avatar key={c.id} character={c} size={26} />
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
        <div key={i} className="work-card">
          <div className="work-cover skeleton" style={{ borderRadius: 0 }} />
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
  const submit = () => {
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), subtitle: subtitle.trim() },
      {
        onSuccess: (s) => {
          props.onOpenChange(false);
          setTitle('');
          setSubtitle('');
          navigate(`/series/${s.id}/bible`);
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
      footer={
        <>
          <button className="btn ghost" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!title.trim() || create.isPending}
            onClick={submit}
          >
            {t('common.create')}
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
      <header className="page-head">
        <div>
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
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> {t('works.newSeries')}
          </button>
        </div>
      </header>

      {list.isLoading ? <SkeletonGrid /> : null}
      {list.error ? <QueryError error={list.error} onRetry={list.refetch} /> : null}
      {list.data && !list.data.length ? (
        <Empty
          icon={<BookOpen size={24} />}
          title={t('works.emptyTitle')}
          action={
            <>
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> {t('works.newSeries')}
              </button>
              <FilePick accept=".zip,application/zip" onFile={onBundle}>
                <FolderInput size={15} /> {t('works.importBundle')}
              </FilePick>
            </>
          }
        >
          {t('works.empty')}
        </Empty>
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
          {filtered.map((s) => (
            <SeriesCardView key={s.id} series={s} />
          ))}
          {!filtering ? (
            <button className="work-card work-new" onClick={() => setCreating(true)}>
              <Plus size={22} />
              <span>{t('works.newSeries')}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <NewSeriesDialog open={creating} onOpenChange={setCreating} />
      <LegacyImportDialog open={legacy} onOpenChange={setLegacy} />
    </div>
  );
}
