import { ResizableSplit } from '../../components/ResizableSplit';
import { Copy, Download, Stethoscope, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useCopyWorkflow,
  useDeleteWorkflow,
  useDiagnoseWorkflow,
  useImportWorkflow,
  useInstances,
  useWorkflow,
  useWorkflows,
} from '../../api/system';
import type { WorkflowConfig } from '../../api/types';
import { QueryError } from '../../app/errors';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, FilePick, Loading, Modal, Select, TextInput } from '../../components/ui';
import { ConfigurationGuard, jsonObject, saveJson, useDiscardChanges } from './ConfigurationParts';
import { WorkflowEditor } from './WorkflowEditor';
import { DiagnosisView, WorkflowImportPreview } from './WorkflowInspection';

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
  const [instance, setInstance] = useState('');
  const [diagnosisVariant, setDiagnosisVariant] = useState('');
  const [pendingImport, setPendingImport] = useState<{
    workflow: Record<string, unknown>;
    name: string;
    graph: Record<string, unknown>;
    config?: WorkflowConfig;
    notes: string;
  } | null>(null);
  const list = workflows.data ?? [];
  const active = list.find((w) => w.id === selected) ?? list[0];
  const detail = useWorkflow(active?.id);
  const busy = importWf.isPending || copy.isPending || remove.isPending;
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
    try {
      const parsed = jsonObject(await file.text());
      const bundled =
        parsed.graph && typeof parsed.graph === 'object' && !Array.isArray(parsed.graph);
      const graph = bundled ? (parsed.graph as Record<string, unknown>) : parsed;
      importWf.reset();
      setPendingImport({
        workflow: parsed,
        name:
          bundled && typeof parsed.name === 'string'
            ? parsed.name
            : file.name.replace(/\.json$/i, ''),
        graph,
        ...(bundled && parsed.config ? { config: parsed.config as WorkflowConfig } : {}),
        notes: bundled && typeof parsed.notes === 'string' ? parsed.notes : '',
      });
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <section className="config-form">
      <ConfigurationGuard dirty={dirty} />
      <div className="config-section-head">
        <div>
          <h2>{t('config.workflow.title')}</h2>
          <p>{t('config.workflow.intro')}</p>
        </div>
        <FilePick accept=".json" disabled={busy || !!pendingImport} onFile={onFile}>
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
                </button>
              ))}
          </nav>
          {active ? (
            <div className="config-editor">
              <div className="config-toolbar">
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    diagnose.reset();
                    setDiagnosisVariant('');
                    setDiagnosing(true);
                  }}
                >
                  <Stethoscope size={14} />
                  {t('settings.diagnose')}
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
                  className="btn ghost icon sm danger"
                  aria-label={t('common.delete')}
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
                </button>
              </div>
              <WorkflowEditor key={active.id} id={active.id} onDirty={setDirty} />
            </div>
          ) : null}
        </ResizableSplit>
      )}
      <div className="config-next">
        <span>{t('config.workflow.nextHint')}</span>
        <Link className="btn sm" to="/engine?tab=profiles">
          {t('config.workflow.next')}
        </Link>
      </div>
      {pendingImport ? (
        <WorkflowImportPreview
          workflow={pendingImport.workflow}
          name={pendingImport.name}
          saving={importWf.isPending}
          saveError={importWf.error}
          onClose={() => setPendingImport(null)}
          onSave={async () => {
            if (!(await discard(dirty))) return;
            const { workflow: _workflow, ...body } = pendingImport;
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
        title={t('settings.diagnoseTitle', { name: active?.name ?? '' })}
        description={t('settings.diagnoseHint')}
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
            {t('settings.diagnose')}
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
