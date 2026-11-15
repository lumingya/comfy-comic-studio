import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCompileWorkflow, useSaveWorkflow, useWorkflow } from '../../api/system';
import type { WorkflowConfig, WorkflowDocument } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, Select, TextArea, TextInput } from '../../components/ui';
import { Advanced, ConfigurationSaveBar, jsonObject, saveJson } from './ConfigurationParts';
import { WorkflowMappings } from './WorkflowMappings';

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
  const original = useMemo(() => formOf(doc), [doc]);
  const form = draft ?? original;
  const dirty =
    !!draft &&
    Object.keys(original).some(
      (key) => draft[key as keyof typeof draft] !== original[key as keyof typeof original],
    );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const set = (change: Partial<typeof form>) => {
    setDraft({ ...form, ...change });
    compile.reset();
  };
  const graph = useMemo(() => {
    try {
      return jsonObject(form.graph);
    } catch {
      return null;
    }
  }, [form.graph]);
  const config = useMemo(() => {
    try {
      const parsed = jsonObject(form.config);
      if (
        parsed.mapping !== undefined &&
        (!parsed.mapping || typeof parsed.mapping !== 'object' || Array.isArray(parsed.mapping))
      )
        return null;
      if (
        parsed.mapping &&
        !Object.values(parsed.mapping).every(
          (value) =>
            typeof value === 'string' ||
            (Array.isArray(value) && value.every((entry) => typeof entry === 'string')),
        )
      )
        return null;
      return parsed as WorkflowConfig;
    } catch {
      return null;
    }
  }, [form.config]);
  const jsonError = !graph || !config ? t('config.workflow.invalidJson') : '';
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
        {doc.describe.problems?.map((problem, i) => (
          <div className="notice warn" key={i}>
            {problem}
          </div>
        ))}
        <WorkflowMappings
          graph={graph}
          config={config}
          bindings={doc.describe.bindings}
          onChange={(config) => set({ config: pretty(config) })}
        />
        <div className="config-workflow-tools">
          <Advanced lazy title={t('config.workflow.bindings')}>
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
          <Advanced lazy title={t('config.workflow.configJson')}>
            <Field label={t('config.workflow.configJson')}>
              <TextArea mono rows={12} value={form.config} onChange={(config) => set({ config })} />
            </Field>
          </Advanced>
          <Advanced lazy title={t('config.workflow.graphJson')}>
            {doc.source === 'builtin' ? (
              <p className="small muted">{t('config.workflow.builtinHint')}</p>
            ) : null}
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
          <Advanced lazy title={t('config.workflow.preview')}>
            <p className="small muted">{t('config.workflow.previewHint')}</p>
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
          <Advanced lazy title={t('config.workflow.notes')}>
            <Field label={t('config.workflow.notes')}>
              <TextArea rows={3} value={form.notes} onChange={(notes) => set({ notes })} />
            </Field>
          </Advanced>
        </div>
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
