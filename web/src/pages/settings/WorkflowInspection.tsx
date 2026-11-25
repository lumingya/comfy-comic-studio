import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  inspectWorkflow,
  type WorkflowDiagnostic,
  type WorkflowInspection,
} from '../../api/system';
import type { WorkflowConfig } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Field, Loading, Modal, Select } from '../../components/ui';
import { Advanced } from './ConfigurationParts';
import { WorkflowLoraSummary } from './WorkflowLoraSummary';
import { WorkflowMappings } from './WorkflowMappings';
import './WorkflowInspection.css';

const display = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '');

function bindingSummary(bindings: NonNullable<WorkflowInspection['bindings']>) {
  const summary: Record<string, string[]> = {};
  for (const binding of bindings) {
    const key = `${binding.kind}${binding.qualifier ? `:${binding.qualifier}` : ''}`;
    (summary[key] ??= []).push(
      `${binding.node}${binding.field ? `.${binding.field}` : ''} (${binding.source})`,
    );
  }
  return summary;
}

export function DiagnosisView({ d }: { d: WorkflowDiagnostic }) {
  const { t } = useTranslation();
  return (
    <div className="workflow-inspection">
      {d.ok ? <div className="notice ok">{t('config.workflow.inspection.diagnoseOk')}</div> : null}
      {d.missing_nodes.map((m) => (
        <div key={m.class_type} className="notice error">
          {t('settings.missingNode', { name: m.class_type })}{' '}
          <span className="mono small">#{m.nodes.join(', #')}</span>
        </div>
      ))}
      {d.missing_models.map((m, i) => (
        <div key={`model-${i}`} className="notice warn">
          {t('settings.missingModel', { name: display(m.value) })}{' '}
          <span className="mono small">
            #{display(m.node)} {display(m.class_type)}.{display(m.input)}
          </span>
        </div>
      ))}
      {d.invalid_values.map((m, i) => (
        <div key={`value-${i}`} className="notice warn">
          <span className="mono small">
            #{display(m.node)} {display(m.input)}
          </span>
          {' = '}
          {display(m.value)}
          <div className="small muted">
            {t('config.workflow.inspection.allowed', {
              values: Array.isArray(m.allowed) ? m.allowed.slice(0, 6).map(display).join(', ') : '',
            })}
          </div>
        </div>
      ))}
      {(d.missing_inputs ?? []).map((m, i) => (
        <div key={`required-${i}`} className="notice error">
          {t('config.workflow.inspection.missingInput', {
            node: display(m.node),
            input: display(m.input),
          })}
        </div>
      ))}
      {(d.invalid_links ?? []).map((m, i) => (
        <div key={`link-${i}`} className="notice error">
          {t('config.workflow.inspection.invalidLink', {
            node: display(m.node),
            input: display(m.input),
            target: display(m.target),
            index: display(m.index),
          })}
        </div>
      ))}
      {(d.invalid_inputs ?? []).map((m, i) => (
        <div key={`input-${i}`} className="notice error">
          {t('config.workflow.inspection.invalidInput', {
            node: display(m.node),
            input: display(m.input),
            reason: display(m.reason),
          })}
        </div>
      ))}
      <p className="small muted">{t('config.workflow.inspection.diagnosticScope')}</p>
    </div>
  );
}

function InspectionView({ report }: { report: WorkflowInspection }) {
  const { t } = useTranslation();
  const bindings = report.bindings ?? [];
  const candidates = report.candidates ?? [];
  const missing = report.missing ?? [];
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof bindings>();
    for (const binding of report.bindings ?? []) {
      const key = `${binding.kind}${binding.qualifier ? `:${binding.qualifier}` : ''}`;
      const group = groups.get(key) ?? [];
      group.push(binding);
      groups.set(key, group);
    }
    return groups;
  }, [report.bindings]);
  const field = (kind: string) => t(`config.workflow.fields.${kind}`, { defaultValue: kind });
  const targets = (items: typeof bindings) => (
    <dl className="config-facts workflow-inspection-targets">
      {items.map((binding, i) => (
        <div key={i}>
          <dt>
            {field(binding.kind)}
            {binding.qualifier ? ` · ${binding.qualifier}` : ''}
          </dt>
          <dd>
            <span className="mono">
              #{binding.node}
              {binding.field ? ` → ${binding.field}` : ''}
            </span>
            <small className="muted">{binding.source}</small>
          </dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="workflow-inspection">
      <dl className="workflow-inspection-summary">
        <div>
          <dt>{t('config.workflow.inspection.format')}</dt>
          <dd>{t(`config.workflow.inspection.formats.${report.format}`)}</dd>
        </div>
        <div>
          <dt>{t('config.workflow.inspection.recognized')}</dt>
          <dd>{bindings.length}</dd>
        </div>
        <div>
          <dt>{t('config.workflow.inspection.outputs')}</dt>
          <dd>{(report.output_nodes ?? []).map((n) => `#${n}`).join(', ') || '—'}</dd>
        </div>
      </dl>
      {bindings.length ? (
        <dl className="workflow-binding-summary">
          {[...grouped].map(([key, items]) => (
            <div key={key}>
              <dt>
                {field(items[0].kind)}
                {items[0].qualifier ? ` · ${items[0].qualifier}` : ''}
              </dt>
              <dd className="mono">
                {items
                  .map((binding) => `#${binding.node}${binding.field ? ` → ${binding.field}` : ''}`)
                  .join(' · ')}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {report.format === 'ui' ? (
        <div className="notice warn" role="alert">
          <p>{t('config.workflow.uiFormat')}</p>
          <ol>
            <li>{t('config.workflow.uiOpen')}</li>
            <li>{t('config.workflow.uiExport')}</li>
            <li>{t('config.workflow.uiReimport')}</li>
          </ol>
        </div>
      ) : null}
      {missing.length ? (
        <div className="notice warn">
          <strong>
            {t('config.workflow.inspection.missing', { fields: missing.map(field).join('、') })}
          </strong>
          <p className="small">{t('config.workflow.inspection.missingHint')}</p>
        </div>
      ) : null}
      {(report.issues ?? [])
        .filter((issue) => issue.code !== 'ui_format')
        .map((issue, i) => (
          <div
            className={`notice ${issue.severity === 'warning' ? 'warn' : issue.severity === 'info' ? '' : 'error'}`}
            key={i}
          >
            {issue.code === 'dependencies_unchecked'
              ? t('config.workflow.inspection.unchecked')
              : issue.message}
          </div>
        ))}
      {report.importable ? (
        <p className="small muted">
          {t(
            report.compilable
              ? 'config.workflow.inspection.ready'
              : 'config.workflow.inspection.needsMapping',
          )}
        </p>
      ) : null}
      {bindings.length ? (
        <Advanced lazy title={t('config.workflow.bindings')}>
          {() => targets(bindings)}
        </Advanced>
      ) : null}
      <WorkflowLoraSummary controls={report.lora_controls} />
      {candidates.length ? (
        <Advanced
          lazy
          title={t('config.workflow.inspection.candidates')}
          hint={t('config.workflow.inspection.candidatesHint')}
        >
          {() => targets(candidates)}
        </Advanced>
      ) : null}
      {(report.dependencies ?? []).length ? (
        <Advanced lazy title={t('config.workflow.inspection.dependencies')}>
          <dl className="config-facts">
            {report.dependencies!.map((dep) => (
              <div key={dep.class_type}>
                <dt className="mono">{dep.class_type}</dt>
                <dd>#{dep.nodes.join(', #')}</dd>
              </div>
            ))}
            {(report.models ?? []).map((model, i) => (
              <div key={`model-${i}`}>
                <dt className="mono">
                  #{model.node} · {model.field}
                </dt>
                <dd>{model.value}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">{t('config.workflow.inspection.dependencyHint')}</p>
        </Advanced>
      ) : null}
      {report.diagnostics ? <DiagnosisView d={report.diagnostics} /> : null}
    </div>
  );
}

export function WorkflowImportPreview({
  workflow,
  graph,
  config,
  initialInspection,
  name,
  saving,
  saveError,
  onSave,
  onClose,
}: {
  workflow: Record<string, unknown> | null;
  graph: Record<string, unknown>;
  config?: WorkflowConfig;
  initialInspection?: WorkflowInspection;
  name: string;
  saving: boolean;
  saveError: unknown;
  onSave: (config?: WorkflowConfig) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [variant, setVariant] = useState('');
  const [draftConfig, setDraftConfig] = useState<WorkflowConfig | null>(null);
  const inspectedWorkflow = useMemo(
    () => (draftConfig ? { ...workflow, graph, config: draftConfig } : workflow),
    [workflow, graph, draftConfig],
  );
  const query = useQuery({
    queryKey: ['workflow-import-inspection', id, variant, draftConfig],
    queryFn: () => inspectWorkflow({ workflow: inspectedWorkflow!, variant: variant || null }),
    enabled: !!inspectedWorkflow,
    initialData: !variant && !draftConfig ? initialInspection : undefined,
    placeholderData: (previous) => previous,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  // Keep the selector available while another variant is being inspected.
  const [variants, setVariants] = useState<string[]>([]);
  const availableVariants = query.data?.variants ?? variants;
  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title={t('config.workflow.inspection.title', { name })}
      description={t('config.workflow.inspection.intro')}
      footer={
        <>
          <button type="button" className="btn" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving || !query.data?.importable || query.isFetching || query.isError}
            onClick={() => onSave(draftConfig ?? undefined)}
          >
            {saving ? t('config.saving') : t('config.workflow.inspection.save')}
          </button>
        </>
      }
    >
      <div className="workflow-inspection" aria-busy={query.isFetching}>
        {availableVariants.length ? (
          <Field label={t('config.workflow.variant')}>
            <Select
              value={variant}
              disabled={saving}
              onChange={(value) => {
                setVariants(availableVariants);
                setVariant(value);
              }}
              options={[
                { value: '', label: t('common.auto') },
                ...availableVariants.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>
        ) : null}
        {query.isFetching && !query.isPending ? (
          <p role="status" className="small muted">
            {t('common.loading')}
          </p>
        ) : null}
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={query.refetch} />
        ) : (
          <InspectionView report={query.data} />
        )}
        {query.data?.importable && workflow ? (
          <Advanced lazy title={t('config.workflow.adjustMapping')}>
            <fieldset
              className="workflow-import-mappings"
              disabled={saving || query.isFetching || query.isPlaceholderData || query.isError}
            >
              <WorkflowMappings
                disabled={saving || query.isFetching || query.isPlaceholderData || query.isError}
                graph={graph}
                config={draftConfig ?? config ?? {}}
                bindings={bindingSummary(query.data.bindings ?? [])}
                recommendations={query.data.bindings}
                onChange={setDraftConfig}
              />
            </fieldset>
          </Advanced>
        ) : null}
        {saveError ? <QueryError error={saveError} /> : null}
        {workflow ? (
          <Advanced
            lazy
            title={t('config.workflow.graphJson')}
            hint={t('config.workflow.inspection.rawHint')}
          >
            {() => (
              <pre className="config-code" tabIndex={0}>
                {JSON.stringify(workflow, null, 2)}
              </pre>
            )}
          </Advanced>
        ) : null}
      </div>
    </Modal>
  );
}
