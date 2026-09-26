import { Lock, MessageSquareOff, MessageSquarePlus, Trash2, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSfxPresets } from '../../api/canvas';
import {
  DIALOGUE_KINDS,
  type LetteringLayer,
  type LetterStyle,
  type Series,
} from '../../api/types';
import { Field, NumberInput, Select, Switch, TextArea } from '../../components/ui';
import { DEFAULT_STYLE, EFFECTS } from './sfx';

function Color(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="color-field small soft">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(props.value) ? props.value : '#000000'}
        onChange={(e) => props.onChange(e.target.value)}
        aria-label={props.label}
      />
      {props.label}
    </label>
  );
}

export function SfxEditor(props: { style: LetterStyle; onChange: (s: LetterStyle) => void }) {
  const { t } = useTranslation();
  const presets = useSfxPresets();
  const { style } = props;
  const set = (patch: Partial<LetterStyle>) => props.onChange({ ...style, ...patch, preset: '' });
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="preset-row">
        {Object.entries(presets.data ?? {}).map(([name, p]) => (
          <button
            key={name}
            className={`preset-chip ${style.preset === name ? 'active' : ''}`}
            style={{ color: p.fill, textShadow: `0 0 2px ${p.stroke}, 0 0 2px ${p.stroke}` }}
            onClick={() => props.onChange({ ...p, preset: name })}
          >
            {t(`sfx.presets.${name}`, { defaultValue: name })}
          </button>
        ))}
      </div>
      <div className="row">
        <Color label={t('sfx.fill')} value={style.fill} onChange={(fill) => set({ fill })} />
        <Color
          label={t('sfx.stroke')}
          value={style.stroke}
          onChange={(stroke) => set({ stroke })}
        />
      </div>
      <Field label={t('sfx.strokeWidth')}>
        <NumberInput
          value={style.stroke_width}
          min={0}
          max={40}
          onChange={(v) => set({ stroke_width: v ?? 0 })}
        />
      </Field>
      <Field label={`${t('sfx.rotation')} · ${Math.round(style.rotation)}°`}>
        <input
          type="range"
          min={-180}
          max={180}
          value={style.rotation}
          onChange={(e) => set({ rotation: Number(e.target.value) })}
          aria-label={t('sfx.rotation')}
        />
      </Field>
      <Field label={t('sfx.effect')}>
        <Select
          value={style.effect}
          options={EFFECTS.map((e) => ({ value: e, label: t(`sfx.effects.${e}`) }))}
          onChange={(effect) => set({ effect })}
        />
      </Field>
      <Field label={t('sfx.spacing')}>
        <NumberInput
          value={style.letter_spacing}
          min={-40}
          max={200}
          onChange={(v) => set({ letter_spacing: v ?? 0 })}
        />
      </Field>
    </div>
  );
}

export function LetterInspector(props: {
  letter: LetteringLayer;
  series: Series;
  onEdit: (patch: Partial<LetteringLayer>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { letter } = props;
  const edit = (patch: Partial<LetteringLayer>) => props.onEdit({ ...patch, locked: true });
  const speakers = [
    { value: '', label: t('script.narrator') },
    ...props.series.bible.characters.map((c) => ({ value: c.id!, label: c.name })),
  ];
  const bubble = letter.kind === 'speech' || letter.kind === 'thought';
  const [x0, , x1, y1] = letter.box;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          {letter.kind === 'sfx' ? t('sfx.heading') : t('canvas.text')}
        </h2>
        <button
          className="btn ghost icon sm"
          title={t('script.locked')}
          onClick={() => props.onEdit({ locked: !letter.locked })}
        >
          {letter.locked ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <button
          className="btn ghost icon sm danger"
          aria-label={t('common.delete')}
          onClick={props.onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {letter.bridge_to ? <span className="chip">{t('canvas.bridge')}</span> : null}
      <TextArea rows={3} value={letter.text} onChange={(text) => edit({ text })} />
      <Field label={t('script.kind')}>
        <Select
          value={letter.kind}
          options={DIALOGUE_KINDS.map((k) => ({ value: k, label: t(`script.kinds.${k}`) }))}
          onChange={(kind) =>
            edit({ kind, style: kind === 'sfx' ? (letter.style ?? DEFAULT_STYLE) : letter.style })
          }
        />
      </Field>
      {letter.kind !== 'sfx' ? (
        <Field label={t('script.speaker')}>
          <Select
            value={letter.speaker_id ?? ''}
            options={speakers}
            onChange={(s) => props.onEdit({ speaker_id: s || null })}
          />
        </Field>
      ) : null}
      <Field label={t('canvas.fontSize')}>
        <NumberInput
          value={letter.font_size}
          min={10}
          max={200}
          placeholder={t('common.auto')}
          onChange={(font_size) => edit({ font_size })}
        />
      </Field>
      <Switch
        checked={letter.vertical}
        onChange={(vertical) => edit({ vertical })}
        label={t('canvas.vertical')}
      />
      {bubble ? (
        <button
          className="btn sm"
          onClick={() =>
            edit({
              tail_to: letter.tail_to
                ? null
                : [Math.round((x0 + x1) / 2 + 30), Math.round(y1 + 60)],
            })
          }
        >
          {letter.tail_to ? <MessageSquareOff size={14} /> : <MessageSquarePlus size={14} />}
          {letter.tail_to ? t('canvas.removeTail') : t('canvas.addTail')}
        </button>
      ) : null}
      {letter.kind === 'sfx' ? (
        <SfxEditor style={letter.style ?? DEFAULT_STYLE} onChange={(style) => edit({ style })} />
      ) : null}
    </div>
  );
}
