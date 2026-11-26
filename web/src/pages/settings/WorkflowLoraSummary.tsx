import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import type { WorkflowLoraControls } from '../../api/workflowLoras';
import { Advanced } from './ConfigurationParts';
import './WorkflowInspection.css';

export function WorkflowLoraSummary({ controls }: { controls?: WorkflowLoraControls | null }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const loras = useMemo(
    () => (controls?.groups ?? []).flatMap((group) => group.loras.map((lora) => ({ group, lora }))),
    [controls],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return loras.filter(({ lora }) => lora.name.toLocaleLowerCase().includes(query));
  }, [loras, search]);
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
      {loras.length > 12 ? (
        <input
          className="input"
          type="search"
          aria-label={t('config.workflow.trial.lora.search')}
          placeholder={t('config.workflow.trial.lora.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      {search && !visible.length ? (
        <p className="small muted" role="status">
          {t('config.workflow.trial.lora.noMatches')}
        </p>
      ) : null}
      <dl className={`config-facts workflow-lora-summary${loras.length > 12 ? ' scroll' : ''}`}>
        {visible.map(({ group, lora }) => (
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
        ))}
      </dl>
      {controls.groups.every(({ loras }) => !loras.length) ? (
        <p className="help">{controls.reason || t('config.workflow.trial.lora.empty')}</p>
      ) : null}
    </Advanced>
  );
}
