import { ResizableSplit } from '../../components/ResizableSplit';
import { Copy, Download, Play, Stethoscope, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCopyWorkflow,
  useDeleteWorkflow,
  useDiagnoseWorkflow,
  useImportWorkflow,
  useInstances,
  useWorkflow,
  useWorkflows,
  inspectWorkflowFile,
  type WorkflowInspection,
} from '../../api/system';
import type { WorkflowConfig } from '../../api/types';
import { QueryError } from '../../app/errors';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, FilePick, Loading, Modal, Select, TextInput } from '../../components/ui';
import { ConfigurationGuard, jsonObject, saveJson, useDiscardChanges } from './ConfigurationParts';
import { WorkflowEditor } from './WorkflowEditor';
import { DiagnosisView, WorkflowImportPreview } from './WorkflowInspection';
import { WorkflowTrial } from './WorkflowTrial';

export function WorkflowsSection() {
  const { t } = useTranslation();
  const workflows = useWorkflows();
  const instances = useInstances();
  const importWf = useImportWorkflow();
  const remove = useDeleteWorkflow();
  const copy = useCopyWorkflow();
  const diagnose = useDiagnoseWorkflow();
  const discard = useDiscardChanges();
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [instance, setInstance] = useState('');
  const [diagnosisVariant, setDiagnosisVariant] = useState('');
  const [reading, setReading] = useState(false);
  const importButton = useRef<HTMLButtonElement>(null);
  const restoreImportFocus = useRef(false);
  const [pendingImport, setPendingImport] = useState<{
    workflow: Record<string, unknown> | null;
    name: string;
    graph: Record<string, unknown>;
    config?: WorkflowConfig;
    notes: string;
    inspection?: WorkflowInspection;
  } | null>(null);
  const list = workflows.data ?? [];
  const active = list.find((w) => w.id === selected) ?? list[0];
  const detail = useWorkflow(active?.id);
  const busy = reading || importWf.isPending || copy.isPending || remove.isPending;
  const focusImportButton = () => {
    restoreImportFocus.current = false;
    // A later explicit focus choice takes precedence over returning from the preview.
    if (document.activeElement && document.activeElement !== document.body) return;
    importButton.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!busy && !pendingImport && restoreImportFocus.current) focusImportButton();
  }, [busy, pendingImport]);
  const instanceId =
    instance ||
    instances.data?.instances.find((i) => i.enabled)?.id ||
    instances.data?.instances[0]?.id ||
    '';
  const choose = async (id: string) => {
    if (id === active?.id || !(await discard(dirty))) return;
    setDirty(false);
    setSelected(id);
  };

  const onFile = async (file: File) => {
    setReading(true);
    try {
      const image = /\.(png|webp)$/i.test(file.name) || /^image\/(png|webp)$/i.test(file.type);
      const decoded = image ? await inspectWorkflowFile(file) : null;
      const parsed = decoded ? (decoded.workflow ?? {}) : jsonObject(await file.text());
      // API node IDs may themselves be "graph", "prompt" or "workflow".
      // Match the decoder's full-graph precedence before unwrapping envelopes.
      const apiGraph =
        Object.keys(parsed).length > 0 &&
        Object.values(parsed).every(
          (node) =>
            node &&
            typeof node === 'object' &&
            !Array.isArray(node) &&
            'class_type' in node &&
            'inputs' in node,
        );
      const bundled =
        !apiGraph &&
        parsed.graph &&
        typeof parsed.graph === 'object' &&
        !Array.isArray(parsed.graph);
      const prompt =
        !apiGraph &&
        parsed.prompt &&
        typeof parsed.prompt === 'object' &&
        !Array.isArray(parsed.prompt);
      const uiEnvelope =
        !apiGraph &&
        parsed.workflow &&
        typeof parsed.workflow === 'object' &&
        !Array.isArray(parsed.workflow);
      const graph = apiGraph
        ? parsed
        : bundled
          ? (parsed.graph as Record<string, unknown>)
          : prompt
            ? (parsed.prompt as Record<string, unknown>)
            : uiEnvelope
              ? (parsed.workflow as Record<string, unknown>)
              : parsed;
      importWf.reset();
      setPendingImport({
        workflow: decoded ? decoded.workflow : parsed,
        name:
          bundled && typeof parsed.name === 'string'
            ? parsed.name
            : file.name.replace(/\.(json|png|webp)$/i, ''),
        graph,
        ...(bundled && parsed.config ? { config: parsed.config as WorkflowConfig } : {}),
        notes: bundled && typeof parsed.notes === 'string' ? parsed.notes : '',
        ...(decoded ? { inspection: decoded.inspection } : {}),
      });
    } catch (error) {
      toastError(error);
    } finally {
      setReading(false);
    }
  };

  return (
    <section className="config-form">
      <ConfigurationGuard dirty={dirty} />
      <div className="config-section-head">
        <div>
          <h2>{t('config.workflow.title')}</h2>
        </div>
        <FilePick
          ref={importButton}
          accept=".json,.png,.webp"
          disabled={busy || !!pendingImport}
          onFile={onFile}
        >
          <Upload size={15} />
          {t('settings.importWorkflow')}
        </FilePick>
      </div>
      {workflows.isError ? (
        <QueryError error={workflows.error} onRetry={workflows.refetch} />
      ) : workflows.isLoading ? (
        <Loading />
      ) : !list.length ? (
        <Empty title={t('config.workflow.empty')}>{t('config.workflow.emptyHint')}</Empty>
      ) : (
        <ResizableSplit
          className="config-split"
          storageKey="workflows"
          label={t('config.workflow.list')}
        >
          <nav className="config-rail" aria-label={t('config.workflow.list')}>
            <TextInput
              value={search}
              onChange={setSearch}
              aria-label={t('config.workflow.search')}
              placeholder={t('config.workflow.search')}
            />
            {list
              .filter((w) =>
                `${w.name} ${w.checkpoint ?? ''}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((w) => (
                <button
                  type="button"
                  key={w.id}
                  className={`config-rail-item ${active?.id === w.id ? 'active' : ''}`}
                  aria-pressed={active?.id === w.id}
                  onClick={() => void choose(w.id)}
                >
                  <strong>{w.name}</strong>
                  <small>
                    {t('settings.nodes', { count: w.nodes })} ·{' '}
                    {t(`config.workflow.sources.${w.source}`)}
                  </small>
                  {w.lora_error ? <small>{t('config.workflow.loraUnavailable')}</small> : null}
                </button>
              ))}
          </nav>
          {active ? (
            <div className="config-editor">
              <div className="config-toolbar">
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={dirty || !detail.data || busy}
                  title={dirty ? t('config.workflow.trial.saveFirst') : undefined}
                  onClick={() => setTrialOpen(true)}
                >
                  <Play size={14} />
                  {t('config.workflow.trial.open')}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={dirty || !detail.data}
                  title={dirty ? t('config.workflow.saveFirst') : undefined}
                  onClick={() => {
                    diagnose.reset();
                    setDiagnosisVariant('');
                    setDiagnosing(true);
                  }}
                >
                  <Stethoscope size={14} />
                  {t('config.workflow.check')}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || dirty}
                  title={dirty ? t('config.workflow.saveFirst') : undefined}
                  onClick={() =>
                    copy.mutate(active.id, {
                      onSuccess: (doc) => {
                        setSelected(doc.id);
                        toast(t('config.workflow.copied'));
                      },
                      onError: toastError,
                    })
                  }
                >
                  <Copy size={14} />
                  {t('common.duplicate')}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!detail.data || dirty}
                  title={dirty ? t('config.workflow.saveFirst') : undefined}
                  onClick={() =>
                    detail.data &&
                    saveJson(
                      {
                        name: detail.data.name,
                        graph: detail.data.graph,
                        config: detail.data.config,
                        notes: detail.data.notes,
                      },
                      `${active.name}.mio-workflow.json`,
                    )
                  }
                >
                  <Download size={14} />
                  {t('config.workflow.export')}
                </button>
                <span className="grow" />
                <button
                  type="button"
                  className="btn ghost sm danger"
                  title={
                    active.source === 'builtin'
                      ? t('config.workflow.builtinHint')
                      : t('common.delete')
                  }
                  disabled={active.source === 'builtin' || busy}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: t('config.workflow.deleteTitle', { name: active.name }),
                        description: t('config.workflow.deleteHint'),
                        confirmLabel: t('common.delete'),
                        danger: true,
                      }))
                    )
                      return;
                    remove.mutate(active.id, {
                      onSuccess: () => {
                        setDirty(false);
                        setSelected('');
                      },
                      onError: toastError,
                    });
                  }}
                >
                  <Trash2 size={14} />
                  {t('config.workflow.delete')}
                </button>
              </div>
              {dirty ? <p className="small muted">{t('config.workflow.trial.saveFirst')}</p> : null}
              <WorkflowEditor key={active.id} id={active.id} onDirty={setDirty} />
            </div>
          ) : null}
        </ResizableSplit>
      )}
      {active ? (
        <WorkflowTrial
          key={active.id}
          workflowId={active.id}
          name={active.name}
          open={trialOpen}
          onOpenChange={setTrialOpen}
          dirty={dirty}
          instances={instances.data?.instances ?? []}
        />
      ) : null}
      {pendingImport ? (
        <WorkflowImportPreview
          workflow={pendingImport.workflow}
          graph={pendingImport.graph}
          config={pendingImport.config}
          initialInspection={pendingImport.inspection}
          imageMetadata={!!pendingImport.inspection}
          name={pendingImport.name}
          saving={importWf.isPending}
          saveError={importWf.error}
          onClose={() => setPendingImport(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (importButton.current?.disabled) restoreImportFocus.current = true;
            else focusImportButton();
          }}
          onSave={async (config) => {
            if (!(await discard(dirty))) return;
            const { workflow: _workflow, inspection: _inspection, ...body } = pendingImport;
            if (config) body.config = config;
            importWf.mutate(body, {
              onSuccess: (doc) => {
                setDirty(false);
                setSelected(doc.id);
                setPendingImport(null);
                toast(t('settings.imported'));
              },
            });
          }}
        />
      ) : null}
      <Modal
        open={diagnosing}
        onOpenChange={setDiagnosing}
        title={t('config.workflow.checkTitle', { name: active?.name ?? '' })}
        footer={
          <button
            type="button"
            className="btn primary"
            disabled={!instanceId || !detail.data || diagnose.isPending}
            onClick={() =>
              active &&
              diagnose.mutate(
                { id: active.id, instance: instanceId, variant: diagnosisVariant || null },
                { onError: toastError },
              )
            }
          >
            <Stethoscope size={15} />
            {t('config.workflow.check')}
          </button>
        }
      >
        {detail.data?.describe.variants?.length ? (
          <Field label={t('config.workflow.variant')}>
            <Select
              value={diagnosisVariant}
              onChange={(value) => {
                setDiagnosisVariant(value);
                diagnose.reset();
              }}
              options={[
                { value: '', label: t('common.auto') },
                ...detail.data.describe.variants.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>
        ) : null}
        {instances.isError ? (
          <QueryError error={instances.error} onRetry={instances.refetch} />
        ) : instanceId ? (
          <Field label={t('config.workflow.diagnoseInstance')}>
            <Select
              value={instanceId}
              onChange={(value) => {
                setInstance(value);
                diagnose.reset();
              }}
              options={(instances.data?.instances ?? []).map((i) => ({
                value: i.id,
                label: `${i.name} · ${i.base_url}`,
              }))}
            />
          </Field>
        ) : (
          <div className="notice warn">{t('settings.noInstances')}</div>
        )}
        {dirty ? <p className="notice warn">{t('config.workflow.diagnoseSaved')}</p> : null}
        {diagnose.data ? (
          <div className="config-result">
            {diagnose.data.selected_nodes ? (
              <p className="small muted">
                {t('config.workflow.inspection.checkedNodes', {
                  count: diagnose.data.selected_nodes.length,
                })}
              </p>
            ) : null}
            {(diagnose.data.warnings ?? []).map((warning, i) => (
              <p className="notice warn" key={i}>
                {warning}
              </p>
            ))}
            <DiagnosisView d={diagnose.data} />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
