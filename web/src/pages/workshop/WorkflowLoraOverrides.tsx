import { useTranslation } from 'react-i18next';
import { useWorkflowLoras, type LoraGroupPatch, type LoraSlotPatch } from '../../api/workflowLoras';
import { QueryError } from '../../app/errors';
import { LoraToggleList } from '../settings/LoraToggleList';

export function WorkflowLoraOverrides({
  workflowId,
  title,
  value,
  onChange,
  disabled,
  inheritTask,
}: {
  workflowId: string;
  title: string;
  value: LoraGroupPatch[];
  onChange: (value: LoraGroupPatch[]) => void;
  disabled?: boolean;
  inheritTask?: boolean;
}) {
  const { t } = useTranslation();
  const query = useWorkflowLoras(workflowId);
  const groups = query.data?.groups.filter((group) => group.loras.length) ?? [];
  if (!groups.length || query.isError) {
    return (
      <>
        {query.isError ? (
          <QueryError error={query.error} onRetry={query.refetch} />
        ) : (
          <p className="help">
            {t(query.isPending ? 'common.loading' : 'config.workflow.trial.lora.empty')}
          </p>
        )}
        {value.length ? (
          <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([])}>
            {t('ws.generation.loraClear')}
          </button>
        ) : null}
      </>
    );
  }
  const getPatch = (groupKey: string, loraKey: string) =>
    value.find((group) => group.key === groupKey)?.loras.find((lora) => lora.key === loraKey);
  const edit = (
    groupKey: string,
    loraKey: string,
    changes: Partial<{ enabled: boolean; strength: number; clip: number | null }>,
  ) => {
    const source = groups
      .find(({ key }) => key === groupKey)
      ?.loras.find(({ key }) => key === loraKey);
    if (!source) return;

    const patch: LoraSlotPatch = {
      ...getPatch(groupKey, loraKey),
      key: source.key,
      name: source.name,
    };
    if ('enabled' in changes) {
      if (changes.enabled === undefined || (!inheritTask && changes.enabled === source.enabled))
        delete patch.enabled;
      else patch.enabled = changes.enabled;
    }
    if (changes.strength != null) {
      if (!inheritTask && changes.strength === source.strength) delete patch.strength;
      else patch.strength = changes.strength;
    }
    if (changes.clip != null) {
      if (!inheritTask && changes.clip === source.clip) delete patch.clip;
      else patch.clip = changes.clip;
    }
    const next = value.filter(({ key }) => key !== groupKey);
    const loras =
      value.find(({ key }) => key === groupKey)?.loras.filter(({ key }) => key !== loraKey) ?? [];
    if (patch.enabled !== undefined || patch.strength !== undefined || patch.clip !== undefined)
      loras.push(patch);
    if (loras.length) next.push({ key: groupKey, loras });
    onChange(next);
  };
  const current = groups.map((group) => ({
    key: group.key,
    loras: group.loras.map((source) => ({ ...source, ...getPatch(group.key, source.key) })),
  }));
  return (
    <LoraToggleList
      title={title}
      groups={groups}
      value={current}
      disabled={disabled}
      toggleOverride={
        inheritTask
          ? {
              get: (groupKey, loraKey) => getPatch(groupKey, loraKey)?.enabled,
              set: (groupKey, loraKey, enabled) => edit(groupKey, loraKey, { enabled }),
            }
          : undefined
      }
      onReset={() => onChange([])}
      onEdit={edit}
    />
  );
}
