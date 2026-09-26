import { Eye, Plus, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCompositionPreview } from '../../api/canvas';
import { assetUrl, uploadAsset } from '../../api/client';
import { CONTROL_KINDS, type ControlInput, type Episode, type Panel } from '../../api/types';
import { toastError } from '../../components/toast';
import { Field, FilePick, Select, Switch } from '../../components/ui';

function ControlRow(props: {
  control: ControlInput;
  takes: Episode['takes'];
  onChange: (c: ControlInput) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const c = props.control;
  const sources = (['auto', 'asset', 'take'] as const).filter(
    (s) => s !== 'auto' || c.kind === 'pose',
  );
  return (
    <div className="control-row">
      <Select
        value={c.kind}
        options={CONTROL_KINDS.map((k) => ({ value: k, label: t(`composition.kinds.${k}`) }))}
        onChange={(kind) =>
          props.onChange({
            ...c,
            kind,
            source: kind !== 'pose' && c.source === 'auto' ? 'take' : c.source,
          })
        }
      />
      <Select
        value={c.source}
        options={sources.map((s) => ({ value: s, label: t(`composition.sources.${s}`) }))}
        onChange={(source) => props.onChange({ ...c, source })}
      />
      {c.source === 'asset' ? (
        <FilePick
          className="btn sm"
          accept="image/*"
          onFile={(file) =>
            uploadAsset(file, file.name)
              .then((a) => props.onChange({ ...c, asset_id: a.id }))
              .catch(toastError)
          }
        >
          {c.asset_id ? (
            <img className="control-thumb" src={assetUrl(c.asset_id, 80)} alt="" />
          ) : (
            <Upload size={13} />
          )}
          {t('composition.upload')}
        </FilePick>
      ) : c.source === 'take' ? (
        <Select
          value={c.take_id ?? ''}
          options={[
            { value: '', label: t('composition.pickTake') },
            ...props.takes.map((tk, i) => ({
              value: tk.id,
              label: `#${i + 1} · ${t(`composition.takeStatus.${tk.status}`)}`,
            })),
          ]}
          onChange={(take_id) => props.onChange({ ...c, take_id: take_id || null })}
        />
      ) : (
        <span className="small muted">{t('composition.autoHint')}</span>
      )}
      <label className="small soft strength">
        {t('composition.strength')} {c.strength.toFixed(2)}
        <input
          type="range"
          min={0}
          max={200}
          value={Math.round(c.strength * 100)}
          onChange={(e) => props.onChange({ ...c, strength: Number(e.target.value) / 100 })}
        />
      </label>
      <button
        className="btn ghost icon sm"
        aria-label={t('common.remove')}
        onClick={props.onRemove}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** ControlNet inputs and regional multi-character prompts for one panel. */
export function CompositionEditor(props: {
  episode: Episode;
  draft: Panel;
  set: (changes: Partial<Panel>) => void;
}) {
  const { t } = useTranslation();
  const { draft, set } = props;
  const preview = useCompositionPreview(props.episode.id);
  const controls = draft.controls ?? [];
  const takes = props.episode.takes.filter((tk) => tk.panel_id === draft.id);
  const edit = (i: number, c: ControlInput) =>
    set({ controls: controls.map((x, j) => (j === i ? c : x)) });
  const data = preview.data;
  return (
    <div className="col" style={{ gap: 12 }}>
      <Switch
        checked={!!draft.regional}
        onChange={(regional) => set({ regional })}
        label={t('composition.regional')}
      />
      <Field label={t('composition.controls')} hint={t('composition.controlsHint')}>
        <div className="col" style={{ gap: 8 }}>
          {controls.map((c, i) => (
            <ControlRow
              key={i}
              control={c}
              takes={takes}
              onChange={(next) => edit(i, next)}
              onRemove={() => set({ controls: controls.filter((_, j) => j !== i) })}
            />
          ))}
          <div className="row">
            <button
              className="btn sm"
              onClick={() =>
                set({
                  controls: [
                    ...controls,
                    { kind: 'pose', source: 'auto', asset_id: null, take_id: null, strength: 0.8 },
                  ],
                })
              }
            >
              <Plus size={13} /> {t('composition.add')}
            </button>
            <button
              className="btn sm ghost"
              disabled={preview.isPending}
              onClick={() => preview.mutate({ panelId: draft.id }, { onError: toastError })}
            >
              <Eye size={13} /> {t('composition.preview')}
            </button>
          </div>
        </div>
      </Field>
      {data ? (
        <div className="composition-preview">
          <div
            className="composition-frame"
            style={{ aspectRatio: `${data.width} / ${data.height}` }}
          >
            {data.pose_asset_id ? <img src={assetUrl(data.pose_asset_id)} alt="pose" /> : null}
            {data.regions.map((r, i) => (
              <div
                key={r.character_id}
                className={`region r${i % 4}`}
                style={{
                  left: `${r.box[0] * 100}%`,
                  top: `${r.box[1] * 100}%`,
                  width: `${(r.box[2] - r.box[0]) * 100}%`,
                  height: `${(r.box[3] - r.box[1]) * 100}%`,
                }}
              >
                <span>
                  {i + 1} · {r.name}
                </span>
              </div>
            ))}
          </div>
          <ol className="small region-prompts">
            {data.regions.map((r) => (
              <li key={r.character_id}>
                <strong>{r.name}</strong> <code>{r.prompt}</code>
              </li>
            ))}
          </ol>
          {(data.warnings ?? []).map((w) => (
            <div key={w} className="notice warn small">
              {w}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
