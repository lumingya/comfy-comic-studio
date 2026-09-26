import { useTranslation } from 'react-i18next';
import type { Panel } from '../../api/types';
import { Field, NumberInput, Select, TextInput } from '../../components/ui';
import { css, parseStops, validSpec } from '../canvas/backdrop';

/** Transition presets: the gap after the panel. */
const TRANSITIONS: { id: string; spec: string }[] = [
  { id: 'none', spec: 'transparent' },
  { id: 'night', spec: '#1b1f2e' },
  { id: 'dusk', spec: '#f4c9a1' },
  { id: 'dawn', spec: '#f7efe2' },
  { id: 'toNight', spec: '#ffffff>#1b1f2e' },
  { id: 'toDay', spec: '#1b1f2e>#ffffff' },
  { id: 'flash', spec: '#ffffff>#fff3bf>#ffffff' },
];

export function swatch(spec: string): string {
  const stops = parseStops(spec);
  if (!stops) return 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 10px 10px';
  return stops.length === 1
    ? css(stops[0])
    : `linear-gradient(180deg, ${stops.map(css).join(', ')})`;
}

/** Strip attributes of one panel: inset placement, rhythm (gap) and the transition background. */
export function StripFields(props: { draft: Panel; set: (changes: Partial<Panel>) => void }) {
  const { t } = useTranslation();
  const { draft, set } = props;
  const spec = draft.transition_background || 'transparent';
  return (
    <div className="col" style={{ gap: 12 }}>
      {draft.width_mode === 'inset' ? (
        <div className="grid-2">
          <Field label={t('script.insetAlign')}>
            <Select
              value={draft.inset_align ?? 'center'}
              onChange={(inset_align) => set({ inset_align })}
              options={(['left', 'center', 'right'] as const).map((a) => ({
                value: a,
                label: t(`script.align.${a}`),
              }))}
            />
          </Field>
          <Field
            label={`${t('script.insetScale')} · ${Math.round((draft.inset_scale ?? 0.78) * 100)}%`}
          >
            <input
              type="range"
              min={40}
              max={95}
              value={Math.round((draft.inset_scale ?? 0.78) * 100)}
              onChange={(e) => set({ inset_scale: Number(e.target.value) / 100 })}
              aria-label={t('script.insetScale')}
            />
          </Field>
        </div>
      ) : null}
      <div className="grid-2">
        <Field label={t('script.gapAfter')} hint={t('script.gapHint')}>
          <NumberInput
            value={draft.gap_after}
            min={0}
            max={1200}
            onChange={(v) => set({ gap_after: v ?? 0 })}
          />
        </Field>
        <Field
          label={t('script.transition')}
          hint={validSpec(spec) ? t('script.transitionHint') : t('script.transitionBad')}
        >
          <TextInput
            mono
            value={spec}
            onChange={(transition_background) => set({ transition_background })}
          />
        </Field>
      </div>
      <div className="swatch-row">
        {TRANSITIONS.map((p) => (
          <button
            key={p.id}
            className={`swatch-btn ${spec === p.spec ? 'active' : ''}`}
            title={t(`script.transitions.${p.id}`)}
            aria-label={t(`script.transitions.${p.id}`)}
            onClick={() => set({ transition_background: p.spec })}
          >
            <span className="swatch" style={{ background: swatch(p.spec) }} />
            <span className="small">{t(`script.transitions.${p.id}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
