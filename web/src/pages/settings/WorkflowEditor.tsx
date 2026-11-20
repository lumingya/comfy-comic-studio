import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveWorkflow, useWorkflow } from '../../api/system';
import type { WorkflowConfig, WorkflowDocument } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, TextArea, TextInput } from '../../components/ui';
import { Advanced, ConfigurationSaveBar, jsonObject } from './ConfigurationParts';
import { WorkflowMappings } from './WorkflowMappings';
import { WorkflowLoraSummary } from './WorkflowLoraSummary';
import { WorkflowDefaultLoras } from './WorkflowDefaultLoras';

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
  const [draft, setDraft] = useState<ReturnType<typeof formOf> | null>(null);
  const [jsonTab, setJsonTab] = useState<'config' | 'graph'>('config');
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
        <WorkflowLoraSummary controls={doc.lora_controls} />
        <WorkflowDefaultLoras
          controls={doc.lora_controls}
          config={config}
          savedConfig={doc.config}
          onChange={(config) => set({ config: pretty(config) })}
          disabled={!graph || form.graph !== original.graph}
        />
        <div className="config-workflow-tools">
          <Advanced lazy title={t('config.workflow.editJson')}>
            <div className="config-toolbar" role="group" aria-label={t('config.workflow.editJson')}>
              {(['config', 'graph'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`btn sm${jsonTab === tab ? ' active' : ''}`}
                  aria-pressed={jsonTab === tab}
                  onClick={() => setJsonTab(tab)}
                >
                  {t(`config.workflow.${tab}Tab`)}
                </button>
              ))}
            </div>
            {jsonTab === 'config' ? (
              <TextArea
                aria-label={t('config.workflow.configJson')}
                mono
                rows={14}
                value={form.config}
                onChange={(config) => set({ config })}
              />
            ) : (
              <>
                {doc.source === 'builtin' ? (
                  <p className="small muted">{t('config.workflow.builtinHint')}</p>
                ) : null}
                <TextArea
                  aria-label={t('config.workflow.graphJson')}
                  mono
                  rows={14}
                  readOnly={doc.source === 'builtin'}
                  value={form.graph}
                  onChange={(graph) => set({ graph })}
                />
              </>
            )}
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
        onCancel={() => setDraft(null)}
      />
    </form>
  );
}
