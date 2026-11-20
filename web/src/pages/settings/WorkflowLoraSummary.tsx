import { useTranslation } from 'react-i18next';
import type { WorkflowLoraControls } from '../../api/workflowLoras';
import { Advanced } from './ConfigurationParts';

export function WorkflowLoraSummary({ controls }: { controls?: WorkflowLoraControls | null }) {
  const { t } = useTranslation();
  if (!controls || (!controls.groups.length && !controls.adapters?.length)) return null;
  return (
    <Advanced lazy title={t('config.workflow.trial.lora.recognized')}>
      {controls.adapters?.length ? (
        <ul className="small muted">
          {controls.adapters.map(({ id, source }) => (
            <li key={id}>
              {id} · {source}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="config-facts">
        {controls.groups.map((group) =>
          group.loras.map((lora) => (
            <div key={`${group.key}:${lora.key}`}>
              <dt>{lora.name}</dt>
              <dd>
                {[
                  lora.source === 'workflow' ? t('config.workflow.trial.lora.source') : lora.source,
                  t(`config.workflow.trial.lora.${lora.enabled ? 'defaultOn' : 'defaultOff'}`),
                  t('config.workflow.trial.lora.modelValue', { value: lora.strength }),
                  lora.clip == null
                    ? null
                    : t('config.workflow.trial.lora.clipValue', { value: lora.clip }),
                  lora.supports_independent_toggle ? null : group.reason,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          )),
        )}
      </dl>
      {controls.groups.every(({ loras }) => !loras.length) ? (
        <p className="help">{controls.reason || t('config.workflow.trial.lora.empty')}</p>
      ) : null}
    </Advanced>
  );
}
