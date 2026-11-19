import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  WorkflowLoraGroup,
  WorkflowLoraGroupOverride,
  WorkflowLoraOverride,
} from '../../api/workflowTrial';

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
  disabled = false,
}: {
  groups: WorkflowLoraGroup[];
  value: WorkflowLoraGroupOverride[];
  onChange: (value: WorkflowLoraGroupOverride[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const update = (groupKey: string, loraKey: string, changes: Partial<WorkflowLoraOverride>) => {
    onChange(
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
  const reset = () => onChange(defaultLoraOverrides(groups));

  return (
    <section className="lora-toggle-list" aria-label={t('config.workflow.trial.lora.title')}>
      <div className="lora-toggle-list-head">
        <div>
          <strong>{t('config.workflow.trial.lora.title')}</strong>
          <p className="small muted">{t('config.workflow.trial.lora.hint')}</p>
        </div>
        <button type="button" className="btn sm" onClick={reset} disabled={disabled}>
          <RotateCcw size={14} />
          {t('config.workflow.trial.lora.reset')}
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
              return (
                <div className="lora-toggle-row" key={source.key}>
                  <div className="lora-toggle-identity">
                    <label className="lora-toggle-switch">
                      <input
                        type="checkbox"
                        checked={lora.enabled}
                        disabled={!source.supports_independent_toggle}
                        aria-label={t('config.workflow.trial.lora.toggle', { name: source.name })}
                        onChange={(event) =>
                          update(group.key, source.key, { enabled: event.target.checked })
                        }
                      />
                      <span>{source.name}</span>
                    </label>
                    <small className="muted">{source.source}</small>
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
