import { Play, ScanSearch, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useActiveRenders } from '../../api/jobs';
import { useFinalize, useQA, useRender } from '../../api/production';
import { useTakeAction, type TakeAction } from '../../api/series';
import type { Panel, Take } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import { Empty, Modal, NumberInput, Select, Switch } from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { EditDialog } from './EditDialog';
import { PendingCard, TakeCard } from './TakeCard';

export default function BoardTab() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const ui = useUI();
  const render = useRender(episode.id);
  const finalize = useFinalize(episode.id);
  const qa = useQA(episode.id);
  const action = useTakeAction(episode.id);
  const { byPanel } = useActiveRenders(episode.id);
  const [editing, setEditing] = useState<Take | null>(null);
  const [zoom, setZoom] = useState<Take | null>(null);

  const variants = series.variants ?? [];
  const variantId = variants.some((v) => v.id === ui.variantId) ? ui.variantId : null;
  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const takes = episode.takes.filter((tk) => (tk.variant_id ?? null) === variantId);
  const takesOf = (p: Panel) =>
    takes
      .filter((tk) => tk.panel_id === p.id && (ui.showRejected || tk.status !== 'rejected'))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const adopted = takes.filter((tk) => tk.status === 'adopted');
  const missing = panels.filter(
    (p) => !p.locked && !takes.some((tk) => tk.panel_id === p.id && tk.status !== 'rejected'),
  );

  const queued = () => toast(t('board.queued'));
  const run = (panelIds: string[] | null) =>
    render.mutate(
      { panel_ids: panelIds, candidates: ui.candidates, variant_ids: [variantId] },
      { onSuccess: queued, onError: toastError },
    );
  const act = (take: Take, a: TakeAction) =>
    action.mutate({ takeId: take.id, action: a }, { onError: toastError });

  if (!panels.length)
    return (
      <Empty
        action={
          <Link className="btn primary" to="../script">
            {t('episode.script')}
          </Link>
        }
      >
        {t('board.noPanels')}
      </Empty>
    );

  return (
    <div className="board">
      <div className="board-toolbar">
        {variants.length ? (
          <Select
            value={variantId ?? ''}
            onChange={(v) => ui.setVariant(v || null)}
            options={[
              { value: '', label: t('board.baseVariant') },
              ...variants.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        ) : null}
        <label className="row small soft">
          {t('board.candidates')}
          <span style={{ width: 64 }}>
            <NumberInput
              value={ui.candidates}
              min={1}
              max={8}
              onChange={(n) => ui.setCandidates(n ?? 1)}
            />
          </span>
        </label>
        <Switch
          checked={ui.showRejected}
          onChange={ui.setShowRejected}
          label={t('board.showRejected')}
        />
        <span className="grow" />
        <button
          className="btn"
          disabled={!adopted.length || qa.isPending}
          onClick={() =>
            qa.mutate(
              { take_ids: adopted.map((tk) => tk.id) },
              { onSuccess: queued, onError: toastError },
            )
          }
        >
          <ScanSearch size={15} /> {t('board.qaAdopted')}
        </button>
        <button
          className="btn"
          disabled={!adopted.length || finalize.isPending}
          onClick={() =>
            finalize.mutate(
              { take_ids: adopted.map((tk) => tk.id) },
              { onSuccess: queued, onError: toastError },
            )
          }
        >
          <Sparkles size={15} /> {t('board.finalize', { count: adopted.length })}
        </button>
        <button
          className="btn"
          disabled={!missing.length || render.isPending}
          onClick={() => run(missing.map((p) => p.id))}
        >
          {t('board.renderMissing', { count: missing.length })}
        </button>
        <button className="btn primary" disabled={render.isPending} onClick={() => run(null)}>
          <Play size={15} /> {t('board.renderAll')}
        </button>
      </div>

      <div className="board-rows">
        {panels.map((p, i) => {
          const list = takesOf(p);
          const pending = (byPanel[p.id] ?? []).filter((it) => it.variantId === variantId);
          return (
            <section key={p.id} className="board-row">
              <header className="board-row-head">
                <span className="panel-no mono">{String(i + 1).padStart(2, '0')}</span>
                <div className="grow">
                  <div className="small">
                    <span className="chip">{t(`script.shots.${p.shot}`)}</span>{' '}
                    {p.description || p.dialogues[0]?.text}
                  </div>
                </div>
                <Link className="btn ghost sm" to={`../script?panel=${p.id}`}>
                  {t('common.edit')}
                </Link>
                <button className="btn sm" disabled={render.isPending} onClick={() => run([p.id])}>
                  <Play size={13} /> {t('board.render')}
                </button>
              </header>
              <div className="take-strip">
                {pending.map((it) => (
                  <PendingCard key={`${it.jobId}:${it.idx}`} item={it} />
                ))}
                {list.map((tk) => (
                  <TakeCard
                    key={tk.id}
                    take={tk}
                    onAdopt={() => act(tk, 'adopt')}
                    onReject={() => act(tk, 'reject')}
                    onRestore={() => act(tk, 'restore')}
                    onEdit={() => setEditing(tk)}
                    onQA={() =>
                      qa.mutate({ take_ids: [tk.id] }, { onSuccess: queued, onError: toastError })
                    }
                    onZoom={() => setZoom(tk)}
                  />
                ))}
                {!list.length && !pending.length ? (
                  <div className="take empty small muted">{t('board.noTakes')}</div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <EditDialog
        key={editing?.id}
        episodeId={episode.id}
        take={editing}
        onClose={() => setEditing(null)}
      />
      <Modal
        open={!!zoom}
        onOpenChange={(o) => !o && setZoom(null)}
        size="lg"
        title={zoom ? `${zoom.stage} · ${zoom.width ?? ''}×${zoom.height ?? ''}` : ''}
      >
        {zoom ? (
          <div className="zoom">
            <img src={assetUrl(zoom.asset_id)} alt="" />
            {zoom.qa?.issues.length ? (
              <ul className="small muted">
                {zoom.qa.issues.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : null}
            <div className="small muted mono">seed {zoom.seed ?? '—'}</div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
