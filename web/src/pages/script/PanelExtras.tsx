import { History, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useActiveRenders } from '../../api/jobs';
import { usePanelHistory, useRestorePanel, type PanelVersion } from '../../api/series';
import { useProfiles } from '../../api/system';
import type { Episode, Panel } from '../../api/types';
import { relativeTime } from '../../app/format';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, Modal, NumberInput, Select, TextInput } from '../../components/ui';
import { SAMPLERS } from './options';

type Values = Record<string, unknown>;

/** Render parameters a workflow binds through [mio:*]; stored in overrides.values by key. */
const RENDER_KEYS = [
  { key: 'steps', step: 1, min: 1, max: 150 },
  { key: 'cfg', step: 0.5, min: 0, max: 30 },
  { key: 'denoise', step: 0.05, min: 0, max: 1 },
] as const;

const num = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : null;

/**
 * Per-panel render overrides the legacy frame editor had as plain fields (渲染档 / 宽 / 高 / 步数 /
 * CFG / 去噪 / 采样器).  Empty = the render profile's value.  Width / height / profile are model
 * fields (they also drive the canvas); the rest land in `overrides.values`, which the executor
 * feeds to the workflow's matching [mio:*] inputs.
 */
export function RenderValuesFields(props: {
  overrides: Panel['overrides'];
  values: Values;
  onChange: (values: Values) => void;
  onOverrides: (changes: Partial<Panel['overrides']>) => void;
}) {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const set = (key: string, value: unknown) => {
    const next = { ...props.values };
    if (value === null || value === '' || value === undefined) delete next[key];
    else next[key] = value;
    props.onChange(next);
  };
  const sampler = typeof props.values.sampler === 'string' ? props.values.sampler : '';
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="grid-3">
        <Field label={t('render.profile')}>
          <Select
            value={props.overrides.profile_id ?? ''}
            onChange={(v) => props.onOverrides({ profile_id: v || null })}
            options={[
              { value: '', label: t('render.profileDefault') },
              ...(profiles.data ?? []).map((p) => ({ value: p.id!, label: p.name })),
            ]}
          />
        </Field>
        <Field label={t('render.width')}>
          <NumberInput
            value={props.overrides.width ?? null}
            onChange={(width) => props.onOverrides({ width })}
            min={256}
            max={4096}
            step={64}
            placeholder={t('render.fromRatio')}
          />
        </Field>
        <Field label={t('render.height')}>
          <NumberInput
            value={props.overrides.height ?? null}
            onChange={(height) => props.onOverrides({ height })}
            min={256}
            max={4096}
            step={64}
            placeholder={t('render.fromRatio')}
          />
        </Field>
        {RENDER_KEYS.map((f) => (
          <Field key={f.key} label={t(`render.${f.key}`)}>
            <NumberInput
              value={num(props.values[f.key])}
              onChange={(v) => set(f.key, v)}
              min={f.min}
              max={f.max}
              step={f.step}
              placeholder={t('render.profileDefault')}
            />
          </Field>
        ))}
        <Field label={t('render.sampler')}>
          <Select
            value={sampler && !SAMPLERS.includes(sampler) ? '__custom' : sampler}
            onChange={(v) => set('sampler', v === '__custom' ? sampler : v)}
            options={[
              { value: '', label: t('render.profileDefault') },
              ...SAMPLERS.map((s) => ({ value: s, label: s })),
              ...(sampler && !SAMPLERS.includes(sampler)
                ? [{ value: '__custom', label: sampler }]
                : []),
            ]}
          />
        </Field>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t('render.valuesHint')}
      </p>
    </div>
  );
}

/** `{变量}` values that apply to this panel only (legacy 逐帧变量覆盖); keys are stored as `$name`. */
export function VariableOverrides(props: {
  values: Values;
  known: string[];
  onChange: (values: Values) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ name: '', value: '' });
  const entries = Object.entries(props.values).filter(([k]) => k.startsWith('$'));
  const set = (key: string, value: string | null) => {
    const next = { ...props.values };
    if (value === null) delete next[key];
    else next[key] = value;
    props.onChange(next);
  };
  const add = () => {
    const name = draft.name.trim().replace(/^\$/, '');
    if (!name) return;
    set(`$${name}`, draft.value);
    setDraft({ name: '', value: '' });
  };
  const suggestions = props.known.filter((k) => !(`$${k}` in props.values));
  return (
    <div className="col" style={{ gap: 8 }}>
      {entries.length ? (
        <div className="kv-table">
          {entries.map(([key, value]) => (
            <VarRow
              key={key}
              name={key.slice(1)}
              value={String(value ?? '')}
              onChange={(v) => set(key, v)}
              onRemove={() => set(key, null)}
            />
          ))}
        </div>
      ) : null}
      <div className="kv-table">
        <TextInput
          mono
          value={draft.name}
          onChange={(name) => setDraft((d) => ({ ...d, name }))}
          placeholder={t('render.varName')}
          list="mio-var-names"
          aria-label={t('render.varName')}
        />
        <TextInput
          mono
          value={draft.value}
          onChange={(value) => setDraft((d) => ({ ...d, value }))}
          placeholder={t('render.varValue')}
          onEnter={add}
          aria-label={t('render.varValue')}
        />
        <button className="btn ghost sm" onClick={add} disabled={!draft.name.trim()}>
          {t('common.add')}
        </button>
        <datalist id="mio-var-names">
          {suggestions.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t('render.varHint')}
      </p>
    </div>
  );
}

function VarRow(props: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <code className="mono small">{`{${props.name}}`}</code>
      <TextInput mono value={props.value} onChange={props.onChange} aria-label={props.name} />
      <button className="btn ghost sm" onClick={props.onRemove}>
        {t('common.remove')}
      </button>
    </>
  );
}

/** Earlier saved versions of this panel; restoring keeps the id and position. */
export function HistoryDialog(props: {
  episodeId: string;
  panel: Panel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const q = usePanelHistory(props.episodeId, props.panel.id, props.open);
  const restore = useRestorePanel(props.episodeId);
  const versions = (q.data ?? []).slice(1); // [0] is the current state
  const summary = (v: PanelVersion) =>
    v.prompt || v.dialogue || v.description || (v.shot ? t(`script.shots.${v.shot}`) : '') || '—';
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('history.title')}
      description={t('history.hint')}
      size="lg"
    >
      {q.isLoading ? <Loading /> : null}
      {q.data && !versions.length ? <p className="muted small">{t('history.none')}</p> : null}
      {versions.length ? (
        <ol className="version-list">
          {versions.map((v) => (
            <li key={v.revision}>
              <span className="small muted mono">#{v.revision}</span>
              <span className="ellipsis" title={summary(v)}>
                <span className="ellipsis" style={{ display: 'block' }}>
                  {summary(v)}
                </span>
                <span className="small muted">{relativeTime(v.created_at, i18n.language)}</span>
              </span>
              <button
                className="btn ghost sm"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(
                    { panelId: props.panel.id!, revision: v.revision },
                    {
                      onSuccess: () => {
                        toast(t('history.restored', { n: v.revision }));
                        props.onOpenChange(false);
                      },
                      onError: toastError,
                    },
                  )
                }
              >
                <RotateCcw size={13} /> {t('history.restore')}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </Modal>
  );
}

/** Latest images of this panel (newest first) plus a "rendering…" chip, without leaving the script. */
export function RecentTakes(props: {
  episode: Episode;
  panelId: string;
  onRender: () => void;
  busy?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const active = useActiveRenders(props.episode.id!).byPanel[props.panelId] ?? [];
  const takes = props.episode.takes
    .filter(
      (take) => take.panel_id === props.panelId && !take.variant_id && take.status !== 'rejected',
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 8);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row small muted">
        <span className="grow">{t('script.recentTakes')}</span>
        {active.length ? (
          <span className="chip warn">{t('script.rendering', { count: active.length })}</span>
        ) : null}
        <button className="btn ghost sm" onClick={props.onRender} disabled={props.busy}>
          <Play size={13} /> {t('script.renderOne')}
        </button>
        <Link className="btn ghost sm" to={`../board?panel=${props.panelId}`}>
          {t('episode.board')}
        </Link>
      </div>
      {takes.length ? (
        <div className="take-strip">
          {takes.map((take) => (
            <figure
              key={take.id}
              className={take.status === 'adopted' ? 'adopted' : ''}
              title={`${take.seed ?? ''} · ${relativeTime(take.created_at, i18n.language)}`}
            >
              <Link to={`../board?panel=${props.panelId}`}>
                <img src={assetUrl(take.asset_id, 192)} alt="" loading="lazy" />
              </Link>
            </figure>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          {t('script.noTakes')}
        </p>
      )}
    </div>
  );
}

export const HistoryIcon = History;
