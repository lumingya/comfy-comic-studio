import { useTranslation } from 'react-i18next';
import type { WorkflowConfig } from '../../api/types';
import type { WorkflowLoraControls } from '../../api/workflowLoras';
import type { WorkflowLoraOverride } from '../../api/workflowTrial';
import { Advanced } from './ConfigurationParts';
import { LoraToggleList } from './LoraToggleList';

type Entry = Record<string, unknown>;
const object = (value: unknown): Entry =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Entry) : {};
const entries = (value: unknown): Entry[] =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
const find = (items: Entry[], key: string) => items.find((item) => item.key === key);

/** Edit only keyed LoRA defaults; the stored graph and unrelated slot settings stay intact. */
export function WorkflowDefaultLoras({
  controls,
  config,
  savedConfig,
  onChange,
  disabled,
}: {
  controls?: WorkflowLoraControls | null;
  config: WorkflowConfig | null;
  savedConfig: WorkflowConfig;
  onChange: (config: WorkflowConfig) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const groups = controls?.groups.filter((group) => group.loras.length) ?? [];
  if (!groups.length) return null;
  const slots = object(config?.slot_overrides);
  const patches = entries(slots.groups);
  const savedSlots = object(savedConfig.slot_overrides);
  const savedPatches = entries(savedSlots.groups);
  const value = groups.map((group) => ({
    key: group.key,
    loras: group.loras.map((source) => {
      const patch = find(entries(find(patches, group.key)?.loras), source.key);
      return patch?.name === source.name ? { ...source, ...patch } : source;
    }),
  }));
  const changeGroups = (next: unknown) => {
    if (!config) return;
    const slot_overrides = { ...slots };
    if (next === undefined) delete slot_overrides.groups;
    else slot_overrides.groups = next;
    const updated: WorkflowConfig = { ...config, slot_overrides };
    if (!Object.keys(slot_overrides).length && savedConfig.slot_overrides === undefined)
      delete updated.slot_overrides;
    if (JSON.stringify(config) !== JSON.stringify(updated)) onChange(updated);
  };
  const edit = (
    groupKey: string,
    loraKey: string,
    changes: Partial<Pick<WorkflowLoraOverride, 'enabled' | 'strength' | 'clip'>>,
  ) => {
    const source = groups
      .find(({ key }) => key === groupKey)
      ?.loras.find(({ key }) => key === loraKey);
    if (!source) return;
    const group = find(patches, groupKey);
    const loras = entries(group?.loras);
    const prior = find(loras, loraKey);
    const savedGroup = find(savedPatches, groupKey);
    const saved = find(entries(savedGroup?.loras), loraKey);
    const patch: Entry = { ...prior, key: loraKey, name: source.name };
    for (const [field, next] of Object.entries(changes)) {
      if (next === source[field as keyof typeof source]) {
        if (saved && Object.hasOwn(saved, field)) patch[field] = saved[field];
        else delete patch[field];
      } else patch[field] = next;
    }
    const keep = Object.keys(patch).some((key) => key !== 'key' && key !== 'name');
    const nextLoras = loras.flatMap((item) =>
      item.key === loraKey ? (keep ? [patch] : []) : [item],
    );
    if (!prior && keep) nextLoras.push(patch);
    const nextGroups = patches.flatMap((item) =>
      item.key === groupKey
        ? nextLoras.length || savedGroup
          ? [{ ...item, loras: nextLoras }]
          : []
        : [item],
    );
    if (!group && nextLoras.length) nextGroups.push({ key: groupKey, loras: nextLoras });
    changeGroups(nextGroups.length || Object.hasOwn(savedSlots, 'groups') ? nextGroups : undefined);
  };
  return (
    <Advanced lazy title={t('config.workflow.loraDefaults')}>
      <LoraToggleList
        title={t('config.workflow.loraDefaults')}
        groups={groups}
        value={value}
        disabled={disabled || !config}
        onEdit={edit}
        resetLabel={t('config.workflow.loraDefaultsReset')}
        onReset={() => changeGroups(savedSlots.groups)}
      />
    </Advanced>
  );
}
