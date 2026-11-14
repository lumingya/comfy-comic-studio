import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  inspectWorkflow,
  type WorkflowDiagnostic,
  type WorkflowInspection,
} from '../../api/system';
import { QueryError } from '../../app/errors';
import { Field, Loading, Modal, Select } from '../../components/ui';
import { Advanced } from './ConfigurationParts';
import './WorkflowInspection.css';

const display = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '');

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
      {report.format === 'ui' ? (
        <div className="notice warn" role="alert">
          {t('config.workflow.uiFormat')}
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
        <Advanced title={t('config.workflow.bindings')}>{targets(bindings)}</Advanced>
      ) : null}
      {candidates.length ? (
        <Advanced
          title={t('config.workflow.inspection.candidates')}
          hint={t('config.workflow.inspection.candidatesHint')}
        >
          {targets(candidates)}
        </Advanced>
      ) : null}
      {(report.dependencies ?? []).length ? (
        <Advanced title={t('config.workflow.inspection.dependencies')}>
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
  name,
  saving,
  saveError,
  onSave,
  onClose,
}: {
  workflow: Record<string, unknown>;
  name: string;
  saving: boolean;
  saveError: unknown;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [variant, setVariant] = useState('');
  const query = useQuery({
    queryKey: ['workflow-import-inspection', id, variant],
    queryFn: () => inspectWorkflow({ workflow, variant: variant || null }),
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
            onClick={onSave}
          >
            {saving ? t('config.saving') : t('config.workflow.inspection.save')}
          </button>
        </>
      }
    >
      <div className="workflow-inspection">
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
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={query.refetch} />
        ) : (
          <InspectionView report={query.data} />
        )}
        {saveError ? <QueryError error={saveError} /> : null}
        <Advanced
          title={t('config.workflow.graphJson')}
          hint={t('config.workflow.inspection.rawHint')}
        >
          <pre className="config-code" tabIndex={0}>
            {JSON.stringify(workflow, null, 2)}
          </pre>
        </Advanced>
      </div>
    </Modal>
  );
}
