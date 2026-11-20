import { Check, ChevronLeft, ChevronRight, Columns2, Scan, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import type { TakeAction } from '../../api/series';
import type { Take } from '../../api/types';
import { shortcutBlocked } from '../../app/shortcuts';
import { CloudRequestDetails, TakeParameterSummary } from '../../components/CloudRequestDetails';
import { BoardZoomDialog } from './BoardZoomDialog';
import './board-review.css';

/** A comparison pins one take; navigation never compares unrelated panels. */
export function BoardReview(props: {
  take: Take;
  takes: ReadonlyMap<string, Take>;
  panelTakes: Take[];
  index: number;
  total: number;
  panelNumber: number;
  onClose: () => void;
  onStep: (delta: number) => void;
  onOpen: (id: string) => void;
  onAction: (take: Take, action: TakeAction) => void;
}) {
  const { t } = useTranslation();
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [side, setSide] = useState(1);
  const [detail, setDetail] = useState(false);
  const pinned = pinnedId ? props.takes.get(pinnedId) : undefined;
  const selected = side === 0 && pinned ? pinned : props.take;
  const alternatives = props.panelTakes.filter((take) => take.id !== pinnedId);
  const canStep = !pinned || alternatives.some((take) => take.id !== props.take.id);
  const step = (delta: number) => {
    if (!pinned) return props.onStep(delta);
    if (!alternatives.length) return;
    const current = alternatives.findIndex((take) => take.id === props.take.id);
    const base = current < 0 ? (delta > 0 ? -1 : 0) : current;
    props.onOpen(alternatives[(base + delta + alternatives.length) % alternatives.length].id);
    setSide(1);
  };
  const compare = () => {
    setDetail(false);
    setSide(1);
    if (pinned) return setPinnedId(null);
    if (props.panelTakes.length < 2) return;
    const current = props.panelTakes.findIndex((take) => take.id === props.take.id);
    const next = props.panelTakes[(current + 1) % props.panelTakes.length];
    setPinnedId(props.take.id);
    props.onOpen(next.id);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        shortcutBlocked(event, document.getElementById('board-zoom')) ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      // At original size the focused viewport retains native arrow-key scrolling.
      if (
        detail &&
        event.target instanceof Element &&
        event.target.closest('.board-compare-viewport') &&
        event.key.startsWith('Arrow')
      )
        return;
      if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key.toLowerCase() === 'c') compare();
      else if (pinned && ['1', '2'].includes(event.key)) setSide(Number(event.key) - 1);
      else if (event.key.toLowerCase() === 'a' && selected.status !== 'adopted')
        props.onAction(selected, 'adopt');
      else if (event.key.toLowerCase() === 'x' && selected.status !== 'rejected')
        props.onAction(selected, 'reject');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <BoardZoomDialog
      open
      comparing={!!pinned}
      onOpenChange={(open) => !open && props.onClose()}
      title={`${t('script.panelNo', { n: props.panelNumber })}${props.index >= 0 ? ` · ${props.index + 1} / ${props.total}` : ''}`}
      description={
        <>
          {selected.stage} · <TakeParameterSummary take={selected} />
        </>
      }
      footer={
        <>
          {pinned ? (
            <p className="board-compare-hint small muted">{t('board.compareHint')}</p>
          ) : null}
          <button className="btn ghost" disabled={!canStep} onClick={() => step(-1)}>
            <ChevronLeft size={15} /> <span className="kbd">←</span>
          </button>
          <button className="btn ghost" disabled={!canStep} onClick={() => step(1)}>
            <span className="kbd">→</span> <ChevronRight size={15} />
          </button>
          <button
            className="btn"
            aria-pressed={!!pinned}
            disabled={!pinned && props.panelTakes.length < 2}
            onClick={compare}
          >
            <Columns2 size={15} /> {t(pinned ? 'board.stopComparing' : 'board.compare')}
            <span className="kbd">C</span>
          </button>
          {pinned ? (
            <button className="btn" aria-pressed={detail} onClick={() => setDetail(!detail)}>
              <Scan size={15} /> {t('board.compareDetail')}
            </button>
          ) : null}
          <span className="grow" />
          {selected.status === 'rejected' ? (
            <button className="btn" onClick={() => props.onAction(selected, 'restore')}>
              {t('board.restore')}
            </button>
          ) : (
            <button className="btn ghost danger" onClick={() => props.onAction(selected, 'reject')}>
              <X size={15} /> {t('board.reject')} <span className="kbd">X</span>
            </button>
          )}
          <button
            className="btn primary"
            disabled={selected.status === 'adopted'}
            onClick={() => props.onAction(selected, 'adopt')}
          >
            <Check size={15} />
            {selected.status === 'adopted' ? t('board.adopted') : t('board.adopt')}
            {selected.status === 'adopted' ? null : <span className="kbd">A</span>}
          </button>
        </>
      }
    >
      {pinned ? (
        <div className="board-compare" data-detail={detail || undefined}>
          {[pinned, props.take].map((take, index) => {
            const label = t(index === 0 ? 'board.compareReference' : 'board.compareCandidate');
            return (
              <section key={index} className="board-compare-side" data-selected={side === index}>
                <button
                  className="board-compare-choice"
                  aria-pressed={side === index}
                  onClick={() => setSide(index)}
                >
                  <span>
                    <span className="kbd">{index + 1}</span> {label}
                  </span>
                  {take.status === 'adopted' ? (
                    <Check size={14} aria-label={t('board.adopted')} />
                  ) : null}
                </button>
                <div
                  className="board-compare-viewport"
                  role="region"
                  aria-label={label}
                  tabIndex={0}
                  onPointerDown={() => setSide(index)}
                  onFocus={() => setSide(index)}
                >
                  <img src={assetUrl(take.asset_id)} alt={label} />
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="zoom">
          <img src={assetUrl(props.take.asset_id)} alt="" />
        </div>
      )}
      <CloudRequestDetails snapshot={selected.cloud_request} />
    </BoardZoomDialog>
  );
}
