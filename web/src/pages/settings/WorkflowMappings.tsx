import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowConfig, WorkflowDocument } from '../../api/types';
import { SearchableSelect } from '../../components/SearchableSelect';
import { TextInput } from '../../components/ui';

const CORE = ['prompt', 'negative', 'seed', 'width', 'height', 'output', 'inspect'] as const;
const pointer = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');

export function WorkflowMappings({
  graph,
  config,
  bindings,
  onChange,
}: {
  graph: Record<string, unknown> | null;
  config: WorkflowConfig | null;
  bindings: WorkflowDocument['describe']['bindings'];
  onChange: (config: WorkflowConfig) => void;
}) {
  const { t } = useTranslation();
  const [newKey, setNewKey] = useState('');
  const mapping = config?.mapping ?? {};
  const { fields, nodes } = useMemo(() => {
    const nodes = Object.entries(graph ?? {}).flatMap(([id, node]) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
      const entry = node as Record<string, unknown>;
      const title = (entry._meta as { title?: string } | undefined)?.title;
      return [
        {
          id,
          entry,
          value: `/${pointer(id)}`,
          label: `#${id} · ${title || entry.class_type || id}`,
          search: String(entry.class_type ?? ''),
        },
      ];
    });
    const fields = nodes.flatMap((node) =>
      Object.entries((node.entry.inputs ?? {}) as Record<string, unknown>).flatMap(
        ([input, current]) => {
          const linked =
            Array.isArray(current) &&
            current.length === 2 &&
            typeof current[0] === 'string' &&
            Number.isInteger(current[1]);
          return linked
            ? []
            : [
                {
                  value: `${node.value}/inputs/${pointer(input)}`,
                  label: `${node.label} → ${input}`,
                  search: node.search,
                },
              ];
        },
      ),
    );
    return { fields, nodes };
  }, [graph]);
  const custom = Object.keys(mapping).filter((key) => !CORE.includes(key as (typeof CORE)[number]));
  const setTargets = (key: string, targets: string[]) => {
    if (!config) return;
    const unique = [...new Set(targets.filter(Boolean))];
    onChange({
      ...config,
      mapping: { ...mapping, [key]: unique.length === 1 ? unique[0] : unique },
    });
  };
  const removeMapping = (key: string) => {
    if (!config) return;
    const next = { ...mapping };
    delete next[key];
    onChange({ ...config, mapping: next });
  };
  const addKey = () => {
    const key = newKey.trim();
    if (!key || !config || [...CORE, ...custom].includes(key)) return;
    setTargets(key, []);
    setNewKey('');
  };

  return (
    <section className="config-mappings" aria-label={t('config.workflow.mapping')}>
      <h3>{t('config.workflow.mapping')}</h3>
      <div className="config-mapping-grid">
        {[...CORE, ...custom].map((key) => {
          const isCore = CORE.includes(key as (typeof CORE)[number]);
          const label = isCore ? t(`config.workflow.fields.${key}`) : key;
          const manual = mapping[key];
          const targets = (Array.isArray(manual) ? manual : manual ? [manual] : []).filter(Boolean);
          const kind = key.split(':', 1)[0];
          const nodeSelector = kind === 'output' || kind === 'inspect';
          const options = nodeSelector ? nodes : fields;
          const available = options.filter((option) => !targets.includes(option.value));
          const detected = (bindings?.[key] ?? [])
            .map((target) => target.replace(/ \([^)]*\)$/, ''))
            .join(' · ');
          return (
            <div className="config-mapping-field" key={key}>
              <div className="config-mapping-label">
                <span>{label}</span>
                {!isCore ? (
                  <button
                    type="button"
                    className="btn ghost icon sm"
                    aria-label={t('config.workflow.removeMapping', { name: label })}
                    onClick={() => removeMapping(key)}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              {targets.map((target, index) => {
                const value = nodeSelector ? target.replace(/\/inputs\/.*$/, '') : target;
                const missing = !options.some((option) => option.value === value);
                return (
                  <div className="config-mapping-target" key={`${index}-${target}`}>
                    <SearchableSelect
                      label={
                        index
                          ? t('config.workflow.targetNumber', { name: label, count: index + 1 })
                          : label
                      }
                      value={value}
                      disabled={!config}
                      options={[
                        ...(missing ? [{ value, label: t('config.missing', { id: value }) }] : []),
                        ...options.filter(
                          (option) => option.value === value || !targets.includes(option.value),
                        ),
                      ]}
                      onChange={(next) =>
                        setTargets(
                          key,
                          targets.map((current, i) => (i === index ? next : current)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn ghost icon sm"
                      aria-label={t('config.workflow.removeTarget', {
                        name: label,
                        count: index + 1,
                      })}
                      onClick={() =>
                        targets.length > 1 || !isCore
                          ? setTargets(
                              key,
                              targets.filter((_, i) => i !== index),
                            )
                          : removeMapping(key)
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              <SearchableSelect
                label={targets.length ? t('config.workflow.addTargetFor', { name: label }) : label}
                value=""
                disabled={!config}
                options={[
                  {
                    value: '',
                    label: targets.length
                      ? t('config.workflow.addTarget')
                      : t('config.workflow.automatic'),
                  },
                  ...available,
                ]}
                onChange={(target) => {
                  if (target) setTargets(key, [...targets, target]);
                }}
              />
              {!targets.length ? (
                <small>
                  {detected
                    ? t('config.workflow.detected', { targets: detected })
                    : t('config.workflow.unbound')}
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="config-mapping-add">
        <TextInput
          aria-label={t('config.workflow.parameterName')}
          placeholder={t('config.workflow.parameterName')}
          value={newKey}
          onChange={setNewKey}
          onEnter={addKey}
        />
        <button
          type="button"
          className="btn sm"
          disabled={!config || !newKey.trim() || [...CORE, ...custom].includes(newKey.trim())}
          onClick={addKey}
        >
          <Plus size={14} />
          {t('config.workflow.addMapping')}
        </button>
      </div>
    </section>
  );
}
