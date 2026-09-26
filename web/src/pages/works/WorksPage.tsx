import { Archive, Download, FolderInput, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { download } from '../../api/client';
import { useCreateSeries, useSeriesList, useTrashSeries } from '../../api/series';
import { useImportBundle } from '../../api/system';
import type { Series } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { ActionMenu, Empty, Field, FilePick, Loading, Modal, TextInput } from '../../components/ui';
import { LegacyImportDialog } from './LegacyImportDialog';

function SeriesCard({ series, index }: { series: Series; index: number }) {
  const { t } = useTranslation();
  const trash = useTrashSeries();
  const cast = series.bible?.characters ?? [];
  return (
    <article className="work-card">
      <Link to={`/series/${series.id}`} className="work-cover">
        <span className="work-index mono">{String(index + 1).padStart(2, '0')}</span>
        <h3>{series.title}</h3>
        {series.subtitle ? <p>{series.subtitle}</p> : null}
        <div className="work-cast">
          {cast.slice(0, 4).map((c) => (
            <span key={c.id} className="work-avatar" title={c.name}>
              {c.name.slice(0, 1)}
            </span>
          ))}
        </div>
      </Link>
      <footer className="row small">
        <span className="chip">{t(`series.status.${series.status ?? 'draft'}`)}</span>
        <span className="muted">{t('works.characters', { count: cast.length })}</span>
        <span className="grow" />
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
              onSelect: () => trash.mutate(series.id, { onError: toastError }),
            },
          ]}
        />
      </footer>
    </article>
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const list = useSeriesList();
  const importBundle = useImportBundle();
  const [creating, setCreating] = useState(false);
  const [legacy, setLegacy] = useState(false);

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
        <div className="grow">
          <div className="overline">Mio Studio</div>
          <h1>{t('works.heading')}</h1>
          <p>{t('works.sub')}</p>
        </div>
        <button className="btn ghost" onClick={() => setLegacy(true)}>
          <Archive size={15} /> {t('works.importLegacy')}
        </button>
        <FilePick accept=".zip,application/zip" onFile={onBundle} disabled={importBundle.isPending}>
          <FolderInput size={15} /> {t('works.importBundle')}
        </FilePick>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> {t('works.newSeries')}
        </button>
      </header>

      {list.isLoading ? <Loading /> : null}
      {list.error ? <QueryError error={list.error} /> : null}
      {list.data && !list.data.length ? (
        <Empty
          action={
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> {t('works.newSeries')}
            </button>
          }
        >
          {t('works.empty')}
        </Empty>
      ) : null}
      <div className="work-grid">
        {list.data?.map((s, i) => (
          <SeriesCard key={s.id} series={s} index={i} />
        ))}
      </div>

      <NewSeriesDialog open={creating} onOpenChange={setCreating} />
      <LegacyImportDialog open={legacy} onOpenChange={setLegacy} />
    </div>
  );
}
