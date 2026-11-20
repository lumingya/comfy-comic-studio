import { useTranslation } from 'react-i18next';
import type { LetteringLayer, Strip } from '../../api/types';
import { LETTER_ALIGNMENTS, type LetterAlignment } from './canvasTools';

/** Batch actions stay next to an explicitly selected text layer, including on touch devices. */
export function LetterTools(props: {
  strip: Strip;
  selected: string[];
  source: LetteringLayer;
  onToggle: (id: string) => void;
  onAlign: (alignment: LetterAlignment) => void;
  onSync: () => void;
  onAvoid: () => void;
  avoiding: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const canAvoid = props.strip.lettering.some(
    (layer) =>
      props.selected.includes(layer.id) && (layer.kind === 'speech' || layer.kind === 'thought'),
  );
  return (
    <div className="col" style={{ gap: 10 }}>
      <details>
        <summary>{t('canvas.letterSelection')}</summary>
        <div className="col" style={{ gap: 6, maxHeight: 180, overflowY: 'auto' }}>
          {props.strip.lettering.map((layer, index) => (
            <label key={layer.id} className="row small">
              <input
                type="checkbox"
                checked={props.selected.includes(layer.id)}
                aria-label={t('canvas.selectLetter', {
                  n: index + 1,
                  text: layer.text.slice(0, 40),
                })}
                onChange={() => props.onToggle(layer.id)}
              />
              <span>
                {index + 1} · {layer.text.slice(0, 40)}
              </span>
            </label>
          ))}
        </div>
      </details>
      {props.selected.length > 1 ? (
        <>
          <span className="small muted">
            {t('canvas.selectedLetters', { count: props.selected.length })}
          </span>
          <div
            className="row"
            role="group"
            aria-label={t('canvas.align')}
            style={{ flexWrap: 'wrap' }}
          >
            {LETTER_ALIGNMENTS.map((alignment) => (
              <button
                key={alignment}
                type="button"
                className="btn sm"
                onClick={() => props.onAlign(alignment)}
              >
                {t(`canvas.alignments.${alignment}`)}
              </button>
            ))}
          </div>
          <button type="button" className="btn sm" onClick={props.onSync}>
            {t('canvas.syncLetterStyle')}
          </button>
        </>
      ) : null}
      {canAvoid ? (
        <button
          type="button"
          className="btn sm"
          disabled={props.disabled || props.avoiding}
          onClick={props.onAvoid}
        >
          {t('canvas.avoidBubbles')}
        </button>
      ) : null}
    </div>
  );
}
