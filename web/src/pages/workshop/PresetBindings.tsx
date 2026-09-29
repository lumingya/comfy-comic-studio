import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Preset } from '../../api/workshop';
import { Icon } from '../../app/icons';
import { Modal, Switch } from '../../components/ui';
import {
  BINDING_TYPES,
  bindingProblem,
  blankBinding,
  normalizeBinding,
  sharedTargets,
  type Binding,
} from './bindingRules';

/**
 * Legacy renderPresetWorkshop 「LoRA / 节点输入绑定」: the preset's own node-input writes. Kept
 * folded like the legacy `quiet-advanced` block; opens by itself once the preset has bindings.
 */
export function BindingsSection({
  preset,
  presets,
  onEdit,
  onRemove,
  onToggle,
}: {
  preset: Preset;
  presets: Preset[];
  onEdit: (index: number | 'new') => void;
  onRemove: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const bindings = preset.bindings;
  const values = new Map(preset.entries.map((e) => [e.key, e.value]));
  const shared = sharedTargets(preset, presets);
  return (
    <details className="quiet-advanced preset-bindings" open={bindings.length > 0 || undefined}>
      <summary>
        {t('ws.presets.bindings')}
        {bindings.length ? <span className="setting-count">{bindings.length}</span> : null}
      </summary>
      <div className="preset-bindings-tools">
        <button type="button" className="btn" onClick={() => onEdit('new')}>
          <Icon name="plus" />
          {t('ws.presets.binding.add')}
        </button>
      </div>
      {bindings.length ? (
        <ul className="preset-binding-list" aria-label={t('ws.presets.bindings')}>
          {bindings.map((b, i) => {
            const target = `${b.node_id} · ${b.path}`;
            const also = shared.get(`${b.node_id}/${b.path}`);
            const current = b.source === 'variable' ? (values.get(b.value) ?? null) : null;
            return (
              <li key={i} className={`preset-binding-row ${b.enabled ? '' : 'is-off'}`}>
                <div className="grow">
                  <strong>{target}</strong>
                  <p>
                    {b.source === 'variable'
                      ? t('ws.presets.binding.fromVar', {
                          key: b.value,
                          value:
                            current === null
                              ? t('ws.presets.binding.varMissing')
                              : current || t('ws.presets.binding.varEmpty'),
                        })
                      : t('ws.presets.binding.fixed', { value: b.value || '""' })}
                    {' · '}
                    {t(`ws.presets.binding.types.${b.type}`)}
                  </p>
                  {also ? (
                    <p className="help">
                      {t('ws.presets.binding.shared', { titles: also.join('、') })}
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={b.enabled}
                  onChange={(on) => onToggle(i, on)}
                  label={
                    <span className="sr-only">{t('ws.presets.binding.enableOf', { target })}</span>
                  }
                />
                <button
                  type="button"
                  className="btn ghost icon sm"
                  aria-label={t('ws.presets.binding.editOf', { target })}
                  title={t('ws.presets.binding.edit')}
                  onClick={() => onEdit(i)}
                >
                  <Icon name="edit" sm />
                </button>
                <button
                  type="button"
                  className="btn ghost icon sm"
                  aria-label={t('ws.presets.binding.removeOf', { target })}
                  title={t('ws.presets.binding.remove')}
                  onClick={() => onRemove(i)}
                >
                  <Icon name="trash" sm />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="help">{t('ws.presets.bindingsHelp')}</p>
    </details>
  );
}

/** Legacy workshop-binding-new / workshop-binding-save: add or edit one binding. */
export function BindingDialog({
  preset,
  index,
  onSave,
  onClose,
}: {
  preset: Preset;
  index: number | 'new';
  onSave: (bindings: Binding[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [b, setB] = useState<Binding>(() =>
    index === 'new' ? blankBinding() : { ...preset.bindings[index] },
  );
  const [tried, setTried] = useState(false);
  const others = preset.bindings.filter((_, i) => i !== index);
  const problem = bindingProblem(b, others);
  const set = (changes: Partial<Binding>) => setB((x) => ({ ...x, ...changes }));
  const save = () => {
    setTried(true);
    if (problem) return;
    const next = normalizeBinding(b);
    onSave(
      index === 'new'
        ? [...preset.bindings, next]
        : preset.bindings.map((x, i) => (i === index ? next : x)),
    );
  };
  const listId = 'preset-binding-vars';
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('ws.presets.binding.title')}
      description={t('ws.presets.binding.desc')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="preset-binding-form" className="btn primary">
            <Icon name="check" />
            {t('ws.presets.binding.save')}
          </button>
        </>
      }
    >
      <form
        id="preset-binding-form"
        className="preset-binding-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="preset-binding-pair">
          <div className="field">
            <label className="label" htmlFor="preset-binding-node">
              {t('ws.presets.binding.node')}
            </label>
            <input
              id="preset-binding-node"
              autoFocus
              value={b.node_id}
              placeholder="12"
              onChange={(e) => set({ node_id: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="preset-binding-path">
              {t('ws.presets.binding.path')}
            </label>
            <input
              id="preset-binding-path"
              value={b.path}
              placeholder={t('ws.presets.binding.pathPlaceholder')}
              onChange={(e) => set({ path: e.target.value })}
            />
          </div>
        </div>
        <div className="preset-binding-pair">
          <div className="field">
            <label className="label" htmlFor="preset-binding-source">
              {t('ws.presets.binding.source')}
            </label>
            <select
              id="preset-binding-source"
              value={b.source}
              onChange={(e) => set({ source: e.target.value as Binding['source'] })}
            >
              <option value="literal">{t('ws.presets.binding.sources.literal')}</option>
              <option value="variable">{t('ws.presets.binding.sources.variable')}</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="preset-binding-type">
              {t('ws.presets.binding.type')}
            </label>
            <select
              id="preset-binding-type"
              value={b.type}
              onChange={(e) => set({ type: e.target.value as Binding['type'] })}
            >
              {BINDING_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`ws.presets.binding.types.${k}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="preset-binding-value">
            {b.source === 'variable'
              ? t('ws.presets.binding.varLabel')
              : t('ws.presets.binding.valueLabel')}
          </label>
          <input
            id="preset-binding-value"
            value={b.value}
            list={b.source === 'variable' ? listId : undefined}
            placeholder={b.source === 'variable' ? 'lora' : 'nanami.safetensors'}
            onChange={(e) => set({ value: e.target.value })}
          />
          {b.source === 'variable' ? (
            <datalist id={listId}>
              {preset.entries.map((e) => (
                <option key={e.id} value={e.key}>
                  {e.label || e.key}
                </option>
              ))}
            </datalist>
          ) : null}
          <p className="help">
            {b.source === 'variable'
              ? t('ws.presets.binding.varHelp')
              : t('ws.presets.binding.valueHelp')}
          </p>
        </div>
        <Switch
          checked={b.enabled}
          onChange={(enabled) => set({ enabled })}
          label={t('ws.presets.binding.enabled')}
        />
        {tried && problem ? (
          <p className="error-text" role="alert">
            {t(`ws.presets.binding.problems.${problem}`)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
