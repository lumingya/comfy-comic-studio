import { Copy, Stethoscope, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCopyWorkflow,
  useDeleteWorkflow,
  useDiagnoseWorkflow,
  useImportWorkflow,
  useInstances,
  useWorkflows,
  type Diagnosis,
} from '../../api/system';
import type { WorkflowSummary } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { ActionMenu, Empty, FilePick, Loading, Modal, Select } from '../../components/ui';

function DiagnosisView({ d }: { d: Diagnosis }) {
  const { t } = useTranslation();
  if (d.ok) return <div className="notice ok">{t('settings.diagnoseOk')}</div>;
  return (
    <div className="col" style={{ gap: 10 }}>
      {d.missing_nodes.map((m) => (
        <div key={m.class_type} className="notice error">
          {t('settings.missingNode', { name: m.class_type })}{' '}
          <span className="mono small">#{m.nodes.join(', #')}</span>
        </div>
      ))}
      {d.missing_models.map((m) => (
        <div key={`${m.node}${m.input}`} className="notice warn">
          {t('settings.missingModel', { name: m.value })}{' '}
          <span className="mono small">
            #{m.node} {m.class_type}.{m.input}
          </span>
        </div>
      ))}
      {d.invalid_values.map((m) => (
        <div key={`${m.node}${m.input}v`} className="notice warn">
          <span className="mono small">
            #{m.node} {m.input}
          </span>{' '}
          = {m.value}
          <div className="small muted">{m.allowed.slice(0, 6).join(', ')}</div>
        </div>
      ))}
    </div>
  );
}

export function WorkflowsSection() {
  const { t } = useTranslation();
  const workflows = useWorkflows();
  const instances = useInstances();
  const importWf = useImportWorkflow();
  const remove = useDeleteWorkflow();
  const copy = useCopyWorkflow();
  const diagnose = useDiagnoseWorkflow();
  const [target, setTarget] = useState<WorkflowSummary | null>(null);
  const [instance, setInstance] = useState('');

  const onFile = async (file: File) => {
    try {
      const graph = JSON.parse(await file.text());
      importWf.mutate(
        { name: file.name.replace(/\.json$/i, ''), graph },
        { onSuccess: () => toast(t('settings.imported')), onError: toastError },
      );
    } catch (err) {
      toastError(err);
    }
  };

  const instanceOptions = (instances.data?.instances ?? []).map((i) => ({
    value: i.id,
    label: `${i.name} · ${i.base_url}`,
  }));
  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="row">
        <p className="small muted grow" style={{ margin: 0 }}>
          {t('settings.workflowsHint')}
        </p>
        <FilePick accept=".json,application/json" onFile={onFile}>
          <Upload size={15} /> {t('settings.importWorkflow')}
        </FilePick>
      </div>
      {workflows.isLoading ? <Loading /> : null}
      {workflows.data && !workflows.data.length ? <Empty>{t('common.empty')}</Empty> : null}
      <table className="table">
        <tbody>
          {(workflows.data ?? []).map((w) => (
            <tr key={w.id}>
              <td>
                <strong>{w.name}</strong>
                <div className="small muted mono">{w.checkpoint ?? '—'}</div>
              </td>
              <td className="small muted">
                <span className="chip">{w.source}</span> {t('settings.nodes', { count: w.nodes })}
              </td>
              <td className="small">
                {w.variants.map((v) => (
                  <span key={v} className="chip">
                    {v}
                  </span>
                ))}
                {w.image_inputs.length ? (
                  <span className="chip accent">
                    {t('settings.imageInputs', { count: w.image_inputs.length })}
                  </span>
                ) : null}
              </td>
              <td style={{ width: 40 }}>
                <ActionMenu
                  actions={[
                    {
                      label: t('settings.diagnose'),
                      icon: <Stethoscope size={14} />,
                      onSelect: () => (diagnose.reset(), setTarget(w)),
                    },
                    {
                      label: t('common.duplicate'),
                      icon: <Copy size={14} />,
                      onSelect: () => copy.mutate(w.id, { onError: toastError }),
                    },
                    {
                      label: t('common.delete'),
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onSelect: () => remove.mutate(w.id, { onError: toastError }),
                    },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t('settings.diagnoseTitle', { name: target?.name ?? '' })}
        description={t('settings.diagnoseHint')}
        footer={
          <button
            className="btn primary"
            disabled={!instance || diagnose.isPending}
            onClick={() =>
              target && diagnose.mutate({ id: target.id, instance }, { onError: toastError })
            }
          >
            <Stethoscope size={15} /> {t('settings.diagnose')}
          </button>
        }
      >
        {instanceOptions.length ? (
          <Select
            value={instance}
            onChange={setInstance}
            options={[{ value: '', label: t('bible.select') }, ...instanceOptions]}
          />
        ) : (
          <div className="notice warn">{t('settings.noInstances')}</div>
        )}
        {diagnose.data ? (
          <div style={{ marginTop: 14 }}>
            <DiagnosisView d={diagnose.data} />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
