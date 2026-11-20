import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  WorkflowLoraGroup,
  WorkflowLoraGroupOverride,
  WorkflowLoraOverride,
} from '../../api/workflowTrial';
import './lora-toggle-list.css';

export function defaultLoraOverrides(groups: WorkflowLoraGroup[]): WorkflowLoraGroupOverride[] {
  return groups.map((group) => ({
    key: group.key,
    loras: group.loras.map((lora) => ({ ...lora })),
  }));
}

export function LoraToggleList({
  groups,
  value,
  onChange,
  onReset,
  disabled = false,
  title,
  toggleOverride,
  onEdit,
  resetLabel,
}: {
  groups: WorkflowLoraGroup[];
  value: WorkflowLoraGroupOverride[];
  onChange?: (value: WorkflowLoraGroupOverride[]) => void;
  onReset?: () => void;
  disabled?: boolean;
  title?: string;
  resetLabel?: string;
  onEdit?: (
    groupKey: string,
    loraKey: string,
    changes: Partial<Pick<WorkflowLoraOverride, 'enabled' | 'strength' | 'clip'>>,
  ) => void;
  toggleOverride?: {
    get: (groupKey: string, loraKey: string) => boolean | undefined;
    set: (groupKey: string, loraKey: string, enabled: boolean | undefined) => void;
  };
}) {
  const { t } = useTranslation();
  const update = (
    groupKey: string,
    loraKey: string,
    changes: Partial<Pick<WorkflowLoraOverride, 'enabled' | 'strength' | 'clip'>>,
  ) => {
    if (onEdit) {
      onEdit(groupKey, loraKey, changes);
      return;
    }
    onChange?.(
      value.map((group) =>
        group.key !== groupKey
          ? group
          : {
              ...group,
              loras: group.loras.map((lora) =>
                lora.key === loraKey ? { ...lora, ...changes } : lora,
              ),
            },
      ),
    );
  };
  const reset = onReset ?? (() => onChange?.(defaultLoraOverrides(groups)));

  return (
    <section
      className="lora-toggle-list"
      aria-label={title ?? t('config.workflow.trial.lora.title')}
    >
      <div className="lora-toggle-list-head">
        {!title ? (
          <div>
            <strong>{t('config.workflow.trial.lora.title')}</strong>
            <p className="small muted">{t('config.workflow.trial.lora.hint')}</p>
          </div>
        ) : null}
        <button type="button" className="btn sm" onClick={reset} disabled={disabled}>
          <RotateCcw size={14} />
          {resetLabel ?? t('config.workflow.trial.lora.reset')}
        </button>
      </div>
      {groups.map((group) => {
        const selected = value.find((item) => item.key === group.key);
        return (
          <fieldset className="lora-toggle-group" key={group.key} disabled={disabled}>
            <legend>
              {group.kind}
              {!group.active ? ` · ${t('config.workflow.trial.lora.inactive')}` : ''}
            </legend>
            {group.loras.map((source) => {
              const lora = selected?.loras.find((item) => item.key === source.key) ?? source;
              const mode = toggleOverride?.get(group.key, source.key);
              const off = toggleOverride ? mode === false : !lora.enabled;
              return (
                <div className="lora-toggle-row" data-off={off || undefined} key={source.key}>
                  <div className="lora-toggle-identity">
                    <label className="lora-toggle-switch">
                      <span>{source.name}</span>
                      {toggleOverride ? (
                        <select
                          disabled={!source.supports_independent_toggle}
                          aria-label={source.name}
                          value={mode === undefined ? 'inherit' : mode ? 'on' : 'off'}
                          onChange={(event) =>
                            toggleOverride.set(
                              group.key,
                              source.key,
                              event.target.value === 'inherit'
                                ? undefined
                                : event.target.value === 'on',
                            )
                          }
                        >
                          <option value="inherit">{t('ws.generation.loraInherit')}</option>
                          <option value="on">{t('ws.generation.loraOn')}</option>
                          <option value="off">{t('ws.generation.loraOff')}</option>
                        </select>
                      ) : (
                        <input
                          type="checkbox"
                          checked={lora.enabled}
                          disabled={!source.supports_independent_toggle}
                          aria-label={t('config.workflow.trial.lora.toggle', { name: source.name })}
                          onChange={(event) =>
                            update(group.key, source.key, { enabled: event.target.checked })
                          }
                        />
                      )}
                    </label>
                    <small className="muted">
                      {source.source === 'workflow'
                        ? t('config.workflow.trial.lora.source')
                        : source.source}
                    </small>
                  </div>
                  <div className="lora-toggle-weight">
                    <label>
                      <span>{t('config.workflow.trial.lora.strength', { name: source.name })}</span>
                      <input
                        className="input"
                        type="range"
                        min={source.range.min}
                        max={source.range.max}
                        step="0.05"
                        value={lora.strength}
                        disabled={!source.supports_strength}
                        onChange={(event) =>
                          update(group.key, source.key, { strength: Number(event.target.value) })
                        }
                      />
                    </label>
                    <input
                      className="input lora-toggle-number"
                      type="number"
                      min={source.range.min}
                      max={source.range.max}
                      step="0.05"
                      value={lora.strength}
                      disabled={!source.supports_strength}
                      aria-label={t('config.workflow.trial.lora.strength', { name: source.name })}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next))
                          update(group.key, source.key, { strength: next });
                      }}
                    />
                  </div>
                  {lora.clip !== null && lora.clip !== undefined ? (
                    <label className="lora-toggle-clip">
                      <span>{t('config.workflow.trial.lora.clip', { name: source.name })}</span>
                      <input
                        className="input"
                        type="number"
                        min={source.range.min}
                        max={source.range.max}
                        step="0.05"
                        value={lora.clip}
                        disabled={!source.supports_strength}
                        aria-label={t('config.workflow.trial.lora.clip', { name: source.name })}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) update(group.key, source.key, { clip: next });
                        }}
                      />
                    </label>
                  ) : null}
                  {!source.supports_independent_toggle && group.reason ? (
                    <small className="muted">{group.reason}</small>
                  ) : null}
                </div>
              );
            })}
            {!group.loras.length ? (
              <p className="small muted">{group.reason || t('config.workflow.trial.lora.empty')}</p>
            ) : null}
          </fieldset>
        );
      })}
    </section>
  );
}
