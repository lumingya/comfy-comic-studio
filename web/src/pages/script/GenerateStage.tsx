import { shortcutBlocked } from '../../app/shortcuts';
import { Check, Maximize2, RotateCcw, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useActiveRenders, useLive, type ActiveItem } from '../../api/jobs';
import { useTakeAction, type TakeAction } from '../../api/series';
import type { Episode, Take } from '../../api/types';
import { useComfyHealth } from '../../app/comfy';
import { useUI } from '../../app/ui-store';
import { toastError } from '../../components/toast';
import { Modal } from '../../components/ui';

const COUNTS = [1, 2, 4] as const;

/** One queued / sampling image: the ComfyUI WebSocket preview streams in as it denoises. */
function LiveCard({ item }: { item: ActiveItem }) {
  const { t } = useTranslation();
  const key = `${item.jobId}:${item.idx}`;
  const progress = useLive((s) => s.progress[key]);
  const preview = useLive((s) => s.previews[key]);
  const pct = progress !== undefined ? Math.round(progress * 100) : null;
  const label =
    item.state === 'uncertain'
      ? t('board.uncertain')
      : item.state === 'pending'
        ? t('classic.stage.queued')
        : pct !== null
          ? t('classic.stage.sampling', { pct })
          : t('classic.stage.starting');
  return (
    <figure className={`stage-card live ${item.state}`} aria-busy="true">
      <div className="stage-img">
        {preview ? <img src={preview} alt="" /> : <span className="stage-shimmer" aria-hidden />}
        <span className="stage-scan" aria-hidden />
      </div>
      <figcaption>
        <span className="beacon" aria-hidden />
        <span className="grow ellipsis">{label}</span>
      </figcaption>
      <div className="progress thin">
        <i style={{ width: `${pct ?? 4}%` }} />
      </div>
    </figure>
  );
}

function CandidateCard(props: { take: Take; onZoom: () => void; onAct: (a: TakeAction) => void }) {
  const { t } = useTranslation();
  const take = props.take;
  const adopted = take.status === 'adopted';
  return (
    <figure className={`stage-card ${adopted ? 'adopted' : ''}`}>
      <button className="stage-img" onClick={props.onZoom} aria-label={t('board.zoom')}>
        <img src={assetUrl(take.asset_id, 480)} alt="" loading="lazy" />
        {adopted ? (
          <span className="stage-badge">
            <Check size={11} /> {t('classic.stage.picked')}
          </span>
        ) : null}
      </button>
      <figcaption>
        <button
          className={`btn sm ${adopted ? 'is-adopted' : 'pick'}`}
          disabled={adopted}
          onClick={() => props.onAct('adopt')}
        >
          <Check size={13} /> {adopted ? t('classic.stage.picked') : t('classic.stage.pick')}
        </button>
        <span className="grow" />
        <button
          className="btn ghost icon sm"
          title={t('board.zoom')}
          aria-label={t('board.zoom')}
          onClick={props.onZoom}
        >
          <Maximize2 size={13} />
        </button>
        <button
          className="btn ghost icon sm"
          title={t('board.reject')}
          aria-label={t('board.reject')}
          onClick={() => props.onAct('reject')}
        >
          <X size={14} />
        </button>
      </figcaption>
    </figure>
  );
}

/**
 * The classic "draw and pick" stage under the prompt: choose how many, press Generate, watch
 * the samples stream in over WebSocket, click the one you like.  Everything goes through the
 * same job engine as the board (idempotent render jobs, pause / cancel on the Jobs page).
 */
export function GenerateStage(props: {
  episode: Episode;
  panelId: string;
  onGenerate: (count: number) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const count = useUI((s) => s.candidates);
  const setCount = useUI((s) => s.setCandidates);
  const comfy = useComfyHealth();
  const action = useTakeAction(props.episode.id!);
  const [zoomId, setZoomId] = useState<string | null>(null);
  const live = (useActiveRenders(props.episode.id!).byPanel[props.panelId] ?? []).filter(
    (it) => !it.variantId,
  );
  const takes = props.episode.takes
    .filter((tk) => tk.panel_id === props.panelId && !tk.variant_id && tk.status !== 'rejected')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const shown = takes.slice(0, 12);
  const zoom = takes.find((tk) => tk.id === zoomId) ?? null;
  const zoomAt = zoom ? shown.indexOf(zoom) : -1;
  const picked = takes.some((tk) => tk.status === 'adopted');

  const act = (take: Take, a: TakeAction) =>
    action.mutate({ takeId: take.id, action: a }, { onError: toastError });

  // Zoom view: ←/→ browse, A picks, X discards (same keys as the board).
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        shortcutBlocked(e, document.getElementById('stage-zoom')) ||
        e.repeat ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      const k = e.key.toLowerCase();
      if (k === 'arrowright' || k === 'arrowleft') {
        const next = shown[(zoomAt + (k === 'arrowright' ? 1 : -1) + shown.length) % shown.length];
        if (next) setZoomId(next.id);
      } else if (k === 'a' && zoom.status !== 'adopted') act(zoom, 'adopt');
      else if (k === 'x') {
        act(zoom, 'reject');
        setZoomId(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const blocked = comfy.state === 'offline' || comfy.state === 'unset';
  return (
    <section
      className={`stage ${live.length ? 'is-live' : ''}`}
      aria-label={t('classic.stage.title')}
    >
      <header className="stage-head">
        <div className="grow">
          <div className="eyebrow">{t('classic.stage.eyebrow')}</div>
          <h3>{t('classic.stage.title')}</h3>
        </div>
        <div className="segmented" role="group" aria-label={t('classic.stage.count')}>
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className={count === n ? 'active' : ''}
              aria-pressed={count === n}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          className={`btn primary generate ${live.length ? 'is-live' : ''}`}
          disabled={props.busy}
          onClick={() => props.onGenerate(count)}
          title="Ctrl+Enter"
        >
          <Sparkles size={16} />
          {live.length
            ? t('classic.stage.generateMore', { count })
            : t('classic.stage.generate', { count })}
        </button>
      </header>

      {blocked ? (
        <div className="notice warn stage-notice">
          {comfy.state === 'unset' ? t('classic.stage.noComfy') : t('classic.stage.comfyDown')}{' '}
          <Link to="/settings?tab=instances">{t('classic.stage.openInstances')}</Link>
        </div>
      ) : null}

      {live.length || shown.length ? (
        <div className="stage-grid">
          {live.map((it) => (
            <LiveCard key={`${it.jobId}:${it.idx}`} item={it} />
          ))}
          {shown.map((tk) => (
            <CandidateCard
              key={tk.id}
              take={tk}
              onZoom={() => setZoomId(tk.id)}
              onAct={(a) => act(tk, a)}
            />
          ))}
        </div>
      ) : (
        <div className="stage-empty">
          <span className="stage-empty-art" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <strong>{t('classic.stage.emptyTitle')}</strong>
          <span>{t('classic.stage.emptyBody')}</span>
        </div>
      )}

      <footer className="stage-foot">
        <span>
          {picked
            ? t('classic.stage.pickedHint')
            : shown.length
              ? t('classic.stage.pickHint')
              : t('classic.stage.shortcut')}
        </span>
        <span className="grow" />
        {takes.length > shown.length ? (
          <span className="muted">
            {t('classic.stage.more', { count: takes.length - shown.length })}
          </span>
        ) : null}
        <Link to={`../board?panel=${props.panelId}`}>{t('classic.stage.toBoard')} →</Link>
      </footer>

      <Modal
        id="stage-zoom"
        open={!!zoom}
        onOpenChange={(o) => !o && setZoomId(null)}
        size="lg"
        title={zoom ? `${zoomAt + 1} / ${shown.length}` : ''}
        description={
          zoom
            ? `${zoom.width ?? '?'}×${zoom.height ?? '?'} · ${t('board.seed')} ${zoom.seed ?? '—'}`
            : undefined
        }
        footer={
          zoom ? (
            <>
              <button
                className="btn ghost danger"
                onClick={() => {
                  act(zoom, 'reject');
                  setZoomId(null);
                }}
              >
                <X size={15} /> {t('board.reject')} <span className="kbd">X</span>
              </button>
              <span className="grow" />
              {zoom.status === 'rejected' ? (
                <button className="btn" onClick={() => act(zoom, 'restore')}>
                  <RotateCcw size={15} /> {t('board.restore')}
                </button>
              ) : null}
              <button
                className="btn primary"
                disabled={zoom.status === 'adopted'}
                onClick={() => act(zoom, 'adopt')}
              >
                <Check size={15} />
                {zoom.status === 'adopted' ? t('classic.stage.picked') : t('classic.stage.pick')}
                {zoom.status === 'adopted' ? null : <span className="kbd">A</span>}
              </button>
            </>
          ) : null
        }
      >
        {zoom ? (
          <div className="zoom">
            <img src={assetUrl(zoom.asset_id)} alt="" />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
