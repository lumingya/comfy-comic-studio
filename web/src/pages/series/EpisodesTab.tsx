import { ImageOff, ListOrdered, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  useCreateEpisode,
  useEpisodes,
  useGenerateEpisode,
  useTrashEpisode,
} from '../../api/series';
import { assetUrl } from '../../api/client';
import type { EpisodeSummary } from '../../api/types';
import { QueryError } from '../../app/errors';
import { relativeTime } from '../../app/format';
import { useRecents } from '../../app/recents';
import { toastError } from '../../components/toast';
import {
  ActionMenu,
  Empty,
  Field,
  Loading,
  Modal,
  Progress,
  TextArea,
  TextInput,
} from '../../components/ui';
import { useUndoTrash } from '../../components/undo';
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

function EpisodeRow({ ep, onTrash }: { ep: EpisodeSummary; onTrash: () => void }) {
  const { t, i18n } = useTranslation();
  const done = ep.panel_count > 0 && ep.adopted_count >= ep.panel_count;
  return (
    <li className="episode-item">
      <Link to={`/episodes/${ep.id}/script`} className="episode-row">
        <span className="episode-thumb">
          {ep.cover_asset_id ? (
            <img src={assetUrl(ep.cover_asset_id, 160)} alt="" loading="lazy" />
          ) : (
            <ImageOff size={16} />
          )}
        </span>
        <span className="episode-main">
          <span className="episode-no">{t('series.episodeNo', { n: ep.order + 1 })}</span>
          <strong className="episode-title">{ep.title}</strong>
        </span>
        <span
          className="episode-progress"
          title={t('series.adoptedOf', { done: ep.adopted_count, total: ep.panel_count })}
        >
          <span className="small muted">
            {ep.panel_count
              ? t('series.adoptedOf', { done: ep.adopted_count, total: ep.panel_count })
              : t('series.noPanels')}
          </span>
          {ep.panel_count ? (
            <Progress value={ep.adopted_count / ep.panel_count} className={done ? 'done' : ''} />
          ) : null}
        </span>
        <small className="episode-time muted" title={ep.updated_at}>
          {relativeTime(ep.updated_at, i18n.language)}
        </small>
      </Link>
      <ActionMenu
        actions={[
          {
            label: t('common.delete'),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: onTrash,
          },
        ]}
      />
    </li>
  );
}

export default function EpisodesTab() {
  const { t } = useTranslation();
  const { series } = useSeriesContext();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const page = useEpisodes(series.id!, offset);
  const create = useCreateEpisode(series.id!);
  const trash = useTrashEpisode(series.id!);
  const undo = useUndoTrash();
  const forgetRecent = useRecents((s) => s.forget);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);

  const total = page.data?.total ?? 0;
  const limit = page.data?.limit ?? 50;
  const defaultTitle = t('series.episodeNo', { n: total + 1 });

  const add = () =>
    create.mutate(
      { title: newTitle.trim() || defaultTitle },
      {
        onSuccess: (ep) => {
          setAdding(false);
          setNewTitle('');
          navigate(`/episodes/${ep.id}/script`);
        },
        onError: toastError,
      },
    );

  return (
    <section>
      <div className="row wrap" style={{ marginBottom: 18 }}>
        <span className="muted small grow">{t('works.episodes', { count: total })}</span>
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={15} /> {t('series.newEpisode')}
        </button>
        <button className="btn primary" onClick={() => setGenerating(true)}>
          <Sparkles size={15} /> {t('series.generate')}
        </button>
      </div>
      {page.isLoading ? <Loading /> : null}
      {page.error ? <QueryError error={page.error} onRetry={page.refetch} /> : null}
      {page.data && !page.data.items.length ? (
        <Empty
          icon={<ListOrdered size={24} />}
          title={t('series.emptyTitle')}
          action={
            <>
              <button className="btn primary" onClick={() => setGenerating(true)}>
                <Sparkles size={15} /> {t('series.generate')}
              </button>
              <button className="btn" onClick={() => setAdding(true)}>
                <Plus size={15} /> {t('series.newEpisode')}
              </button>
            </>
          }
        >
          {t('series.emptyBody')}
        </Empty>
      ) : null}
      {page.data?.items.length ? (
        <ol className="episode-list">
          {page.data.items.map((ep) => (
            <EpisodeRow
              key={ep.id}
              ep={ep}
              onTrash={() =>
                trash.mutate(ep.id, {
                  onSuccess: () => {
                    forgetRecent(ep.id);
                    undo('episode', ep.id, ep.title);
                  },
                  onError: toastError,
                })
              }
            />
          ))}
        </ol>
      ) : null}
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
          <>
            <button className="btn ghost" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={create.isPending} onClick={add}>
              {t('common.create')}
            </button>
          </>
        }
      >
        <Field label={t('common.title')}>
          <TextInput
            autoFocus
            value={newTitle}
            onChange={setNewTitle}
            onEnter={add}
            placeholder={defaultTitle}
          />
        </Field>
      </Modal>
      <GenerateDialog seriesId={series.id!} open={generating} onOpenChange={setGenerating} />
    </section>
  );
}
