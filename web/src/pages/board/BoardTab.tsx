import {
  Check,
  ChevronLeft,
  ChevronRight,
  Image,
  Play,
  ScanSearch,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useActiveRenders } from '../../api/jobs';
import { useFinalize, useQA, useRender } from '../../api/production';
import { useTakeAction, type TakeAction } from '../../api/series';
import type { Panel, Take } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import { Empty, Modal, NumberInput, Progress, Select, Switch } from '../../components/ui';
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
  const [zoomId, setZoomId] = useState<string | null>(null);

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
  const adoptedPanels = new Set(adopted.map((tk) => tk.panel_id)).size;
  // Zoom works on ids so the dialog follows live data (adopting shows at once).
  const visible = panels.flatMap((p) => takesOf(p));
  const zoom = visible.find((tk) => tk.id === zoomId) ?? takes.find((tk) => tk.id === zoomId);
  const zoomIndex = zoom ? visible.indexOf(zoom) : -1;
  const zoomPanel = zoom ? panels.findIndex((p) => p.id === zoom.panel_id) : -1;
  const step = (delta: number) => {
    if (!visible.length) return;
    const next = visible[(Math.max(zoomIndex, 0) + delta + visible.length) % visible.length];
    setZoomId(next.id);
  };
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

  // In the zoom view: ←/→ browse every take on the board, A adopts, X rejects.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key.toLowerCase() === 'a' && zoom.status !== 'adopted') act(zoom, 'adopt');
      else if (e.key.toLowerCase() === 'x' && zoom.status !== 'rejected') act(zoom, 'reject');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!panels.length)
    return (
      <Empty
        icon={<Image size={24} />}
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
        <span className="board-summary small muted">
          {t('series.adoptedOf', { done: adoptedPanels, total: panels.length })}
          <Progress
            value={adoptedPanels / panels.length}
            className={adoptedPanels >= panels.length ? 'done' : ''}
          />
        </span>
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
                    onZoom={() => setZoomId(tk.id)}
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
        onOpenChange={(o) => !o && setZoomId(null)}
        size="lg"
        title={
          zoom
            ? `${t('script.panelNo', { n: zoomPanel + 1 })} · ${zoomIndex + 1} / ${visible.length}`
            : ''
        }
        description={
          zoom
            ? `${zoom.stage} · ${zoom.width ?? '?'}×${zoom.height ?? '?'} · ${t('board.seed')} ${zoom.seed ?? '—'}`
            : undefined
        }
        footer={
          zoom ? (
            <>
              <button className="btn ghost" onClick={() => step(-1)}>
                <ChevronLeft size={15} /> <span className="kbd">←</span>
              </button>
              <button className="btn ghost" onClick={() => step(1)}>
                <span className="kbd">→</span> <ChevronRight size={15} />
              </button>
              <span className="grow" />
              {zoom.status === 'rejected' ? (
                <button className="btn" onClick={() => act(zoom, 'restore')}>
                  {t('board.restore')}
                </button>
              ) : (
                <button className="btn ghost danger" onClick={() => act(zoom, 'reject')}>
                  <X size={15} /> {t('board.reject')} <span className="kbd">X</span>
                </button>
              )}
              <button
                className="btn primary"
                disabled={zoom.status === 'adopted'}
                onClick={() => act(zoom, 'adopt')}
              >
                <Check size={15} />
                {zoom.status === 'adopted' ? t('board.adopted') : t('board.adopt')}
                {zoom.status === 'adopted' ? null : <span className="kbd">A</span>}
              </button>
            </>
          ) : null
        }
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
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
