import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  useCreateEpisode,
  useEpisodes,
  useGenerateEpisode,
  useTrashEpisode,
} from '../../api/series';
import { QueryError } from '../../app/errors';
import { toastError } from '../../components/toast';
import { ActionMenu, Empty, Field, Loading, Modal, TextArea, TextInput } from '../../components/ui';
import { useSeriesContext } from './SeriesPage';

function GenerateDialog(props: {
  seriesId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const generate = useGenerateEpisode(props.seriesId);
  const [sentence, setSentence] = useState('');
  const submit = () =>
    generate.mutate(
      { sentence },
      {
        onSuccess: (ep) => {
          props.onOpenChange(false);
          navigate(`/episodes/${ep.id}/script`);
        },
        onError: toastError,
      },
    );
  return (
    <Modal
      open={props.open}
      onOpenChange={(o) => !generate.isPending && props.onOpenChange(o)}
      title={t('series.generate')}
      description={t('series.generateHint')}
      footer={
        <>
          <button
            className="btn ghost"
            disabled={generate.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!sentence.trim() || generate.isPending}
            onClick={submit}
          >
            {generate.isPending ? <span className="spinner" /> : <Sparkles size={15} />}
            {generate.isPending ? t('series.generating') : t('series.generate')}
          </button>
        </>
      }
    >
      <TextArea
        autoFocus
        rows={3}
        value={sentence}
        onChange={setSentence}
        placeholder={t('series.sentencePlaceholder')}
      />
    </Modal>
  );
}

export default function EpisodesTab() {
  const { t } = useTranslation();
  const { series } = useSeriesContext();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const page = useEpisodes(series.id, offset);
  const create = useCreateEpisode(series.id);
  const trash = useTrashEpisode(series.id);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);

  const add = () =>
    create.mutate(
      { title: newTitle.trim() || `第 ${(page.data?.total ?? 0) + 1} 话` },
      {
        onSuccess: (ep) => navigate(`/episodes/${ep.id}/script`),
        onError: toastError,
      },
    );

  const total = page.data?.total ?? 0;
  const limit = page.data?.limit ?? 50;

  return (
    <section>
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="muted small grow">{t('works.episodes', { count: total })}</span>
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={15} /> {t('series.newEpisode')}
        </button>
        <button className="btn primary" onClick={() => setGenerating(true)}>
          <Sparkles size={15} /> {t('series.generate')}
        </button>
      </div>
      {page.isLoading ? <Loading /> : null}
      {page.error ? <QueryError error={page.error} /> : null}
      {page.data && !page.data.items.length ? <Empty>{t('common.empty')}</Empty> : null}
      <ol className="episode-list">
        {page.data?.items.map((ep) => (
          <li key={ep.id}>
            <Link to={`/episodes/${ep.id}/script`} className="episode-row">
              <span className="episode-no mono">{String(ep.order + 1).padStart(2, '0')}</span>
              <span className="grow">
                <strong>{ep.title}</strong>
                <small className="muted">{t('series.panels', { count: ep.panel_count })}</small>
              </span>
              <small className="muted mono">{ep.updated_at.slice(0, 10)}</small>
            </Link>
            <ActionMenu
              actions={[
                {
                  label: t('common.delete'),
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: () => trash.mutate(ep.id, { onError: toastError }),
                },
              ]}
            />
          </li>
        ))}
      </ol>
      {total > limit ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button
            className="btn sm"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            {t('common.prev')}
          </button>
          <span className="small muted">
            {offset + 1}–{Math.min(total, offset + limit)} / {total}
          </span>
          <button
            className="btn sm"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            {t('common.next')}
          </button>
        </div>
      ) : null}

      <Modal
        open={adding}
        onOpenChange={setAdding}
        title={t('series.newEpisode')}
        footer={
          <button className="btn primary" disabled={create.isPending} onClick={add}>
            {t('common.create')}
          </button>
        }
      >
        <Field label={t('common.title')}>
          <TextInput autoFocus value={newTitle} onChange={setNewTitle} onEnter={add} />
        </Field>
      </Modal>
      <GenerateDialog seriesId={series.id} open={generating} onOpenChange={setGenerating} />
    </section>
  );
}
