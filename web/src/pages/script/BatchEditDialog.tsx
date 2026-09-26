import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ANGLES, SHOTS, TIMES, type Panel, type Series } from '../../api/types';
import { Modal, Select, TextInput } from '../../components/ui';
import { RATIOS, WIDTHS } from './options';

/** Which fields to write; unticked fields keep each panel's own value. */
interface Draft {
  shot?: Panel['shot'];
  angle?: Panel['angle'];
  location_id?: string | null;
  time?: Panel['time'];
  aspect_ratio?: string;
  width_mode?: Panel['width_mode'];
  locked?: boolean;
  append_prompt?: string;
  negative_prompt?: string;
}

export interface BatchBody {
  changes: Record<string, unknown>;
  /** Text joined after each panel's own value (server-side) instead of replacing it. */
  append_text: Record<string, string>;
}

/** Turn the ticked fields into the batch body (`overrides` merges server-side). */
export function batchChanges(draft: Draft, mode: 'replace' | 'append'): BatchBody {
  const { append_prompt, negative_prompt, ...plain } = draft;
  const changes: Record<string, unknown> = { ...plain };
  const overrides: Record<string, unknown> = {};
  const append_text: Record<string, string> = {};
  for (const [key, value] of [
    ['append_prompt', append_prompt],
    ['negative_prompt', negative_prompt],
  ] as const) {
    if (value === undefined) continue;
    if (mode === 'append' && value.trim()) append_text[key] = value.trim();
    else overrides[key] = value;
  }
  if (Object.keys(overrides).length) changes.overrides = overrides;
  return { changes, append_text };
}

function Row(props: {
  label: ReactNode;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={`batch-row ${props.on ? 'on' : ''}`}>
      <input
        type="checkbox"
        checked={props.on}
        onChange={(e) => props.onToggle(e.target.checked)}
      />
      <span className="batch-label">{props.label}</span>
      <span className="batch-control">{props.children}</span>
    </label>
  );
}

/**
 * Same edit for every selected panel.  Each field has a "change this" tick so a batch can set
 * the time of day without touching anything else; the prompt can replace or append.
 */
export function BatchEditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  series: Series;
  panels: Panel[];
  busy?: boolean;
  onSubmit: (body: BatchBody) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>({});
  const [promptMode, setPromptMode] = useState<'replace' | 'append'>('append');
  const on = (k: keyof Draft) => draft[k] !== undefined;
  const setOn = (k: keyof Draft, value: Draft[keyof Draft]) => (checked: boolean) =>
    setDraft((d) => {
      const next = { ...d };
      if (checked) (next as Record<string, unknown>)[k] = value;
      else delete next[k];
      return next;
    });
  const set = (changes: Draft) => setDraft((d) => ({ ...d, ...changes }));
  const touched = Object.keys(draft).length > 0;
  const locations = [
    { value: '', label: t('common.none') },
    ...props.series.bible.locations.map((l) => ({ value: l.id!, label: l.name })),
  ];
  const enumSelect = <T extends string>(
    key: keyof Draft,
    values: T[],
    labelOf: (v: T) => string,
    current: T | undefined,
  ) => (
    <Select
      disabled={!on(key)}
      value={(current ?? values[0]) || 'unset'}
      onChange={(v) => set({ [key]: v === 'unset' ? '' : v } as Draft)}
      options={values.map((v) => ({ value: v || 'unset', label: labelOf(v) }))}
    />
  );

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('batch.title', { count: props.count })}
      description={t('batch.hint')}
      footer={
        <>
          <button className="btn ghost" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!touched || props.busy}
            onClick={() => props.onSubmit(batchChanges(draft, promptMode))}
          >
            {t('batch.apply', { count: props.count })}
          </button>
        </>
      }
    >
      <div className="col batch-form">
        <Row
          label={t('script.appendPrompt')}
          on={on('append_prompt')}
          onToggle={setOn('append_prompt', '')}
        >
          <span className="col" style={{ gap: 6 }}>
            <TextInput
              mono
              disabled={!on('append_prompt')}
              value={draft.append_prompt ?? ''}
              onChange={(append_prompt) => set({ append_prompt })}
            />
            <span className="segmented small">
              <button
                className={promptMode === 'append' ? 'active' : ''}
                disabled={!on('append_prompt')}
                onClick={() => setPromptMode('append')}
                type="button"
              >
                {t('batch.appendMode')}
              </button>
              <button
                className={promptMode === 'replace' ? 'active' : ''}
                disabled={!on('append_prompt')}
                onClick={() => setPromptMode('replace')}
                type="button"
              >
                {t('batch.replaceMode')}
              </button>
            </span>
          </span>
        </Row>
        <Row
          label={t('script.negativePrompt')}
          on={on('negative_prompt')}
          onToggle={setOn('negative_prompt', '')}
        >
          <TextInput
            mono
            disabled={!on('negative_prompt')}
            value={draft.negative_prompt ?? ''}
            onChange={(negative_prompt) => set({ negative_prompt })}
          />
        </Row>
        <Row label={t('script.shot')} on={on('shot')} onToggle={setOn('shot', '')}>
          {enumSelect('shot', SHOTS, (v) => t(`script.shots.${v || 'unset'}`), draft.shot)}
        </Row>
        <Row label={t('script.angle')} on={on('angle')} onToggle={setOn('angle', '')}>
          {enumSelect('angle', ANGLES, (v) => t(`script.angles.${v || 'unset'}`), draft.angle)}
        </Row>
        <Row
          label={t('script.location')}
          on={on('location_id')}
          onToggle={setOn('location_id', null)}
        >
          <Select
            disabled={!on('location_id')}
            value={draft.location_id ?? ''}
            onChange={(v) => set({ location_id: v || null })}
            options={locations}
          />
        </Row>
        <Row label={t('bible.time')} on={on('time')} onToggle={setOn('time', '')}>
          {enumSelect('time', TIMES, (v) => t(`script.times.${v || 'unset'}`), draft.time)}
        </Row>
        <Row
          label={t('script.ratio')}
          on={on('aspect_ratio')}
          onToggle={setOn('aspect_ratio', RATIOS[0])}
        >
          <Select
            disabled={!on('aspect_ratio')}
            value={draft.aspect_ratio ?? RATIOS[0]}
            onChange={(aspect_ratio) => set({ aspect_ratio })}
            options={RATIOS.map((r) => ({ value: r, label: r }))}
          />
        </Row>
        <Row
          label={t('script.widthMode')}
          on={on('width_mode')}
          onToggle={setOn('width_mode', 'full')}
        >
          {enumSelect('width_mode', WIDTHS, (v) => t(`script.widths.${v}`), draft.width_mode)}
        </Row>
        <Row label={t('script.locked')} on={on('locked')} onToggle={setOn('locked', true)}>
          <Select
            disabled={!on('locked')}
            value={draft.locked === false ? 'no' : 'yes'}
            onChange={(v) => set({ locked: v === 'yes' })}
            options={[
              { value: 'yes', label: t('script.lock') },
              { value: 'no', label: t('script.unlock') },
            ]}
          />
        </Row>
      </div>
    </Modal>
  );
}
