import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompileWorkflow, useSaveWorkflow, useWorkflow } from '../../api/system';
import type { WorkflowConfig, WorkflowDocument } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, Select, TextArea, TextInput } from '../../components/ui';
import { Advanced, ConfigurationSaveBar, jsonObject, saveJson } from './ConfigurationParts';

const CORE = ['prompt', 'negative', 'seed', 'width', 'height', 'output'] as const;
const pointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const formOf = (doc: WorkflowDocument) => ({
  name: doc.name,
  notes: doc.notes ?? '',
  graph: pretty(doc.graph),
  config: pretty(doc.config),
});

export function WorkflowEditor({ id, onDirty }: { id: string; onDirty: (dirty: boolean) => void }) {
  const query = useWorkflow(id);
  if (query.isError) return <QueryError error={query.error} onRetry={query.refetch} />;
  if (!query.data) return <Loading />;
  return <WorkflowForm key={id} doc={query.data} onDirty={onDirty} />;
}

function WorkflowForm({
  doc,
  onDirty,
}: {
  doc: WorkflowDocument;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const save = useSaveWorkflow();
  const compile = useCompileWorkflow();
  const [draft, setDraft] = useState<ReturnType<typeof formOf> | null>(null);
  const [previewValues, setPreviewValues] = useState(
    '{\n  "prompt": "a quiet street",\n  "seed": 1\n}',
  );
  const [variant, setVariant] = useState('');
  const original = formOf(doc);
  const form = draft ?? original;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const set = (change: Partial<typeof form>) => {
    setDraft({ ...form, ...change });
    compile.reset();
  };
  let config: WorkflowConfig | null = null;
  let graph: Record<string, unknown> | null = null;
  let jsonError = '';
  try {
    graph = jsonObject(form.graph);
    const parsed = jsonObject(form.config);
    if (
      parsed.mapping !== undefined &&
      (!parsed.mapping || typeof parsed.mapping !== 'object' || Array.isArray(parsed.mapping))
    )
      throw new Error('mapping');
    if (
      parsed.mapping &&
      !Object.values(parsed.mapping).every(
        (value) =>
          typeof value === 'string' ||
          (Array.isArray(value) && value.every((entry) => typeof entry === 'string')),
      )
    )
      throw new Error('mapping targets');
    config = parsed as WorkflowConfig;
  } catch {
    jsonError = t('config.workflow.invalidJson');
  }
  const mapping = config?.mapping ?? {};
  const fields = Object.entries(doc.graph).flatMap(([node, value]) =>
    Object.entries(value.inputs).map(([input, current]) => ({
      value: `/${pointer(node)}/inputs/${pointer(input)}`,
      label: `#${node} · ${value._meta?.title || value.class_type} → ${input}`,
      linked: Array.isArray(current),
    })),
  );
  const setMapping = (key: string, target: string) => {
    if (!config || target === '__multiple__') return;
    const next = { ...mapping };
    if (target) next[key] = target;
    else delete next[key];
    set({ config: pretty({ ...config, mapping: next }) });
  };
  const submit = () => {
    if (!config || !graph || !form.name.trim() || save.isPending) return;
    save.mutate(
      {
        id: doc.id,
        patch: {
          name: form.name.trim(),
          notes: form.notes,
          config,
          ...(form.graph !== original.graph && doc.source !== 'builtin' ? { graph } : {}),
        },
      },
      {
        onSuccess: () => {
          setDraft(null);
          compile.reset();
          toast(t('common.saved'));
        },
        onError: toastError,
      },
    );
  };

  return (
    <form
      className="config-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={save.isPending}>
        <Field label={t('common.name')}>
          <TextInput value={form.name} onChange={(name) => set({ name })} />
        </Field>
        <div className="config-subheading">
          <h3>{t('config.workflow.mapping')}</h3>
          <p>{t('config.workflow.mappingHint')}</p>
        </div>
        {doc.describe.problems?.map((problem, i) => (
          <div className="notice warn" key={i}>
            {problem}
          </div>
        ))}
        <div className="config-mapping-grid">
          {CORE.map((key) => {
            const manual = mapping[key];
            const multi = Array.isArray(manual) && manual.length > 1;
            const value = multi
              ? '__multiple__'
              : Array.isArray(manual)
                ? (manual[0] ?? '')
                : (manual ?? '');
            const options = fields.filter((f) => key === 'output' || !f.linked);
            const missing =
              value && value !== '__multiple__' && !options.some((f) => f.value === value);
            return (
              <Field
                key={key}
                label={t(`config.workflow.fields.${key}`)}
                hint={
                  (doc.describe.bindings?.[key] ?? []).join(' · ') || t('config.workflow.unbound')
                }
              >
                <Select
                  value={value}
                  disabled={!config}
                  onChange={(target) => setMapping(key, target)}
                  options={[
                    { value: '', label: t('config.workflow.automatic') },
                    ...(multi
                      ? [
                          {
                            value: '__multiple__',
                            label: t('config.workflow.multiple', { count: manual.length }),
                          },
                        ]
                      : []),
                    ...(missing ? [{ value, label: t('config.missing', { id: value }) }] : []),
                    ...options,
                  ]}
                />
              </Field>
            );
          })}
        </div>
        <Advanced
          title={t('config.workflow.advancedTools')}
          hint={t('config.workflow.advancedHint')}
        >
          <Advanced title={t('config.workflow.bindings')} hint={t('config.workflow.bindingsHint')}>
            <dl className="config-facts">
              {Object.entries(doc.describe.bindings ?? {}).map(([key, targets]) => (
                <div key={key}>
                  <dt className="mono">{key}</dt>
                  <dd>{targets.join(' · ')}</dd>
                </div>
              ))}
            </dl>
            {!Object.keys(doc.describe.bindings ?? {}).length ? (
              <p className="small muted">{t('config.workflow.unbound')}</p>
            ) : null}
            <p className="small muted">{t('config.workflow.savedReport')}</p>
          </Advanced>
          <Advanced title={t('config.workflow.configJson')} hint={t('config.workflow.configHint')}>
            <Field label={t('config.workflow.configJson')}>
              <TextArea mono rows={12} value={form.config} onChange={(config) => set({ config })} />
            </Field>
            <p className="small muted">{t('config.workflow.configExample')}</p>
          </Advanced>
          <Advanced
            title={t('config.workflow.graphJson')}
            hint={
              doc.source === 'builtin'
                ? t('config.workflow.builtinHint')
                : t('config.workflow.graphHint')
            }
          >
            <Field label={t('config.workflow.graphJson')}>
              <TextArea
                mono
                rows={16}
                readOnly={doc.source === 'builtin'}
                value={form.graph}
                onChange={(graph) => set({ graph })}
              />
            </Field>
            <button
              type="button"
              className="btn sm"
              disabled={dirty}
              title={dirty ? t('config.workflow.saveFirst') : undefined}
              onClick={() => saveJson(doc.graph, `${doc.name}.json`)}
            >
              {t('config.workflow.exportGraph')}
            </button>
          </Advanced>
          <Advanced title={t('config.workflow.preview')} hint={t('config.workflow.previewHint')}>
            <Field label={t('config.workflow.previewValues')}>
              <TextArea
                mono
                rows={5}
                value={previewValues}
                onChange={(value) => {
                  setPreviewValues(value);
                  compile.reset();
                }}
              />
            </Field>
            {doc.describe.variants?.length ? (
              <Field label={t('config.workflow.variant')}>
                <Select
                  value={variant}
                  onChange={(value) => {
                    setVariant(value);
                    compile.reset();
                  }}
                  options={[
                    { value: '', label: t('common.auto') },
                    ...doc.describe.variants.map((value) => ({ value, label: value })),
                  ]}
                />
              </Field>
            ) : null}
            {dirty ? <p className="notice warn">{t('config.workflow.saveFirst')}</p> : null}
            <button
              type="button"
              className="btn"
              disabled={dirty || compile.isPending}
              onClick={() => {
                try {
                  compile.mutate(
                    { id: doc.id, values: jsonObject(previewValues), variant: variant || null },
                    { onError: toastError },
                  );
                } catch {
                  toastError(new Error(t('config.workflow.invalidJson')));
                }
              }}
            >
              {t('config.workflow.compile')}
            </button>
            {compile.data ? (
              <>
                <p className="small muted">{t('config.workflow.previewResult')}</p>
                <pre className="config-code" tabIndex={0}>
                  {pretty(compile.data)}
                </pre>
              </>
            ) : null}
          </Advanced>
          <Advanced title={t('config.workflow.notes')}>
            <Field label={t('config.workflow.notes')}>
              <TextArea rows={3} value={form.notes} onChange={(notes) => set({ notes })} />
            </Field>
          </Advanced>
        </Advanced>
        {jsonError ? (
          <p className="notice error" role="alert">
            {jsonError}
          </p>
        ) : null}
      </fieldset>
      <ConfigurationSaveBar
        dirty={dirty}
        pending={save.isPending}
        invalid={!!jsonError || !form.name.trim()}
        onCancel={() => {
          setDraft(null);
          compile.reset();
        }}
      />
    </form>
  );
}
