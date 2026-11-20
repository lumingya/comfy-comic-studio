import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflows } from '../../api/system';
import type { LoraGroupPatch } from '../../api/workflowLoras';
import { QueryError } from '../../app/errors';
import { WorkflowLoraOverrides } from './WorkflowLoraOverrides';

export function FrameLoraSettings({
  overrides,
  onChange,
}: {
  overrides: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState('');
  const savedWorkflow = typeof overrides.workflow_id === 'string' ? overrides.workflow_id : '';
  const workflowId = savedWorkflow || chosen;
  const groups = (Array.isArray(overrides.groups) ? overrides.groups : []) as LoraGroupPatch[];
  const hasOverrides = groups.length > 0;
  const save = (next: LoraGroupPatch[]) => {
    const rest = { ...overrides };
    delete rest.groups;
    delete rest.workflow_id;
    if (!next.length) setChosen(workflowId);
    onChange(
      next.length
        ? {
            ...rest,
            ...((savedWorkflow || !hasOverrides) && { workflow_id: workflowId }),
            groups: next,
          }
        : rest,
    );
  };
  return (
    <details className="quiet-advanced" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {t('ws.generation.loraFrame')}
        {hasOverrides ? <span className="sr-only"> · {t('ws.generation.loraSaved')}</span> : null}
      </summary>
      {open ? (
        <FrameLoraFields
          id={id}
          workflowId={workflowId}
          locked={!!savedWorkflow && hasOverrides}
          onSelect={setChosen}
          groups={groups}
          save={save}
        />
      ) : null}
    </details>
  );
}

function FrameLoraFields({
  id,
  workflowId,
  locked,
  onSelect,
  groups,
  save,
}: {
  id: string;
  workflowId: string;
  locked: boolean;
  onSelect: (workflowId: string) => void;
  groups: LoraGroupPatch[];
  save: (groups: LoraGroupPatch[]) => void;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflows();
  const hasWorkflow = workflows.data?.some(({ id }) => id === workflowId);
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={id}>
          {t('ws.generation.loraWorkflow')}
        </label>
        <select
          id={id}
          value={workflowId}
          disabled={locked || workflows.isPending}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">{t('ws.generation.choose')}</option>
          {workflowId && !hasWorkflow ? <option value={workflowId}>{workflowId}</option> : null}
          {workflows.data?.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <p className="help" id={`${id}-hint`}>
          {t('ws.generation.loraWorkflowHint')}
        </p>
        {workflows.isError ? (
          <QueryError error={workflows.error} onRetry={workflows.refetch} />
        ) : null}
      </div>
      {workflowId && hasWorkflow ? (
        <WorkflowLoraOverrides
          workflowId={workflowId}
          title={t('ws.generation.loraFrame')}
          value={groups}
          onChange={save}
          inheritTask
        />
      ) : null}
      {groups.length && (!workflowId || !hasWorkflow) ? (
        <button type="button" className="btn sm" onClick={() => save([])}>
          {t('ws.generation.loraClear')}
        </button>
      ) : null}
    </>
  );
}
