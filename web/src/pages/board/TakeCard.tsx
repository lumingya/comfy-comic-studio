import { Check, Maximize2, RotateCcw, ScanSearch, Wand2, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import type { ActiveItem } from '../../api/jobs';
import { useLive } from '../../api/jobs';
import type { Take } from '../../api/types';
import { ActionMenu } from '../../components/ui';

export function TakeCard(props: {
  take: Take;
  checked?: boolean;
  onAdopt: () => void;
  onReject: () => void;
  onRestore: () => void;
  onEdit: () => void;
  onQA: () => void;
  onZoom: () => void;
  /** Ctrl / Shift click on the image (plain click zooms). */
  onSelect?: (mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const { t } = useTranslation();
  const take = props.take;
  const qa = take.qa;
  return (
    <figure
      className={`take ${take.status} ${props.checked ? 'checked' : ''}`}
      aria-selected={props.checked || undefined}
      onContextMenu={props.onContextMenu}
    >
      <button
        className="take-image"
        onClick={(e) => {
          if (props.onSelect && (e.ctrlKey || e.metaKey || e.shiftKey)) {
            e.preventDefault();
            props.onSelect({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
          } else props.onZoom();
        }}
        aria-label={t('board.zoom')}
      >
        <img src={assetUrl(take.asset_id, 480)} alt="" loading="lazy" />
      </button>
      <div className="take-badges">
        {take.stage !== 'draft' ? <span className="chip">{take.stage}</span> : null}
        {take.status === 'adopted' ? (
          <span className="chip accent">
            <Check size={11} /> {t('board.adopted')}
          </span>
        ) : null}
        {qa ? (
          <span className={`chip ${qa.passed ? 'accent' : 'warn'}`} title={qa.issues.join('\n')}>
            QA {Math.round(qa.score * 100)}
          </span>
        ) : null}
      </div>
      <figcaption className="take-actions">
        {take.status === 'rejected' ? (
          <button className="btn ghost sm" onClick={props.onRestore}>
            <RotateCcw size={13} /> {t('board.restore')}
          </button>
        ) : (
          <>
            <button
              className={`btn sm ${take.status === 'adopted' ? 'is-adopted' : ''}`}
              onClick={props.onAdopt}
              disabled={take.status === 'adopted'}
            >
              <Check size={13} />{' '}
              {take.status === 'adopted' ? t('board.adoptedShort') : t('board.adopt')}
            </button>
            <button
              className="btn ghost icon sm"
              aria-label={t('board.reject')}
              onClick={props.onReject}
            >
              <X size={14} />
            </button>
          </>
        )}
        <span className="grow" />
        <ActionMenu
          actions={[
            { label: t('board.zoom'), icon: <Maximize2 size={14} />, onSelect: props.onZoom },
            { label: t('board.edit'), icon: <Wand2 size={14} />, onSelect: props.onEdit },
            { label: t('board.qa'), icon: <ScanSearch size={14} />, onSelect: props.onQA },
          ]}
        />
      </figcaption>
    </figure>
  );
}

/** Placeholder for a queued / running item: live sampler preview + progress when available. */
export function PendingCard({ item }: { item: ActiveItem }) {
  const { t } = useTranslation();
  const key = `${item.jobId}:${item.idx}`;
  const progress = useLive((s) => s.progress[key]);
  const preview = useLive((s) => s.previews[key]);
  return (
    <figure className={`take pending ${item.state}`}>
      <div className="take-image">
        {preview ? <img src={preview} alt="" /> : <span className="spinner" />}
      </div>
      <figcaption className="take-actions small muted">
        <span className="ellipsis grow">
          {item.state === 'uncertain' ? t('board.uncertain') : item.label}
        </span>
        {progress !== undefined ? (
          <span className="mono">{Math.round(progress * 100)}%</span>
        ) : null}
      </figcaption>
      {progress !== undefined ? (
        <div className="progress thin">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
    </figure>
  );
}
