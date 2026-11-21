import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import type { Take } from '../../api/types';

export function SplitCompare(props: {
  reference: Take;
  candidate: Take;
  onSelect: (side: number) => void;
}) {
  const { t } = useTranslation();
  const [divider, setDivider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; mode: 'pan' | 'split' } | null>(null);

  return (
    <>
      <div
        className="board-split-viewport"
        role="region"
        aria-label={t('board.compareSplit')}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          props.onSelect(event.clientX < bounds.left + (bounds.width * divider) / 100 ? 0 : 1);
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            mode:
              event.target instanceof Element && event.target.closest('.board-split-handle')
                ? 'split'
                : 'pan',
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.id !== event.pointerId) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (current.mode === 'split') {
            setDivider(
              Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
            );
            return;
          }
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          current.x = event.clientX;
          current.y = event.clientY;
          setPan((position) => ({
            x: Math.max(
              (-bounds.width * (zoom - 1)) / 2,
              Math.min((bounds.width * (zoom - 1)) / 2, position.x + dx),
            ),
            y: Math.max(
              (-bounds.height * (zoom - 1)) / 2,
              Math.min((bounds.height * (zoom - 1)) / 2, position.y + dy),
            ),
          }));
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="board-split-frame"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          <img src={assetUrl(props.reference.asset_id)} alt={t('board.compareReference')} />
        </div>
        <div className="board-split-overlay" style={{ clipPath: `inset(0 0 0 ${divider}%)` }}>
          <div
            className="board-split-frame"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <img src={assetUrl(props.candidate.asset_id)} alt={t('board.compareCandidate')} />
          </div>
        </div>
        <span className="board-split-divider" style={{ left: `${divider}%` }} aria-hidden="true" />
        <button
          type="button"
          className="board-split-handle"
          style={{ left: `${divider}%` }}
          role="slider"
          aria-label={t('board.compareDivider')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(divider)}
          aria-valuetext={`${Math.round(divider)}%`}
          onKeyDown={(event) => {
            const delta = event.shiftKey ? 10 : 2;
            if (event.key === 'ArrowLeft') setDivider((value) => Math.max(0, value - delta));
            else if (event.key === 'ArrowRight')
              setDivider((value) => Math.min(100, value + delta));
            else if (event.key === 'Home') setDivider(0);
            else if (event.key === 'End') setDivider(100);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </div>
      <div className="board-split-controls">
        <label>
          <span>{t('board.compareDivider')}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="0.5"
            value={divider}
            aria-label={t('board.compareDivider')}
            aria-valuetext={`${Math.round(divider)}%`}
            onChange={(event) => setDivider(Number(event.currentTarget.value))}
            onKeyDown={(event) => {
              const delta = event.shiftKey ? 10 : 2;
              if (event.key === 'ArrowLeft') setDivider((value) => Math.max(0, value - delta));
              else if (event.key === 'ArrowRight')
                setDivider((value) => Math.min(100, value + delta));
              else if (event.key === 'Home') setDivider(0);
              else if (event.key === 'End') setDivider(100);
              else return;
              event.preventDefault();
            }}
          />
        </label>
        <label>
          <span>{t('board.compareZoom')}</span>
          <input
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={zoom}
            aria-label={t('board.compareZoom')}
            aria-valuetext={`${zoom.toFixed(1)}×`}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              setZoom(next);
              if (next === 1) setPan({ x: 0, y: 0 });
            }}
          />
        </label>
      </div>
    </>
  );
}
