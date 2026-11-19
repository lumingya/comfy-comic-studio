import { Play } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ApiError, assetUrl, raw } from '../../api/client';
import { useJob, useLive } from '../../api/jobs';
import { useEpisode } from '../../api/series';
import type { ComfyInstance } from '../../api/types';
import {
  useWorkflowTrial,
  type WorkflowLoraGroup,
  type WorkflowLoraGroupOverride,
  type WorkflowTrialRequest,
} from '../../api/workflowTrial';
import { Field, Modal, NumberInput, Select, TextArea } from '../../components/ui';
import { defaultLoraOverrides, LoraToggleList } from './LoraToggleList';
import './WorkflowInspection.css';
import './lora-toggle-list.css';

export function WorkflowTrial({
  workflowId,
  name,
  open,
  onOpenChange,
  dirty,
  instances,
}: {
  workflowId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirty: boolean;
  instances: ComfyInstance[];
}) {
  const { t } = useTranslation();
  const trial = useWorkflowTrial(workflowId);
  const request = useRef<WorkflowTrialRequest | null>(null);
  const submitting = useRef(false);
  const job = useJob(open ? trial.data?.job.id : undefined);
  const episode = useEpisode(open ? trial.data?.episode.id : undefined);
  const progress = useLive((state) =>
    trial.data ? state.progress[`${trial.data.job.id}:0`] : undefined,
  );
  const current = job.data ?? trial.data?.job;
  const finished = !!current && ['completed', 'failed', 'canceled'].includes(current.state);
  const failure =
    current?.error ||
    current?.items?.find((item) => item.state === 'failed' || item.state === 'uncertain')?.error
      ?.message;
  const asset =
    episode.data?.takes?.find((take) => take.job_id === current?.id)?.asset_id ||
    current?.items?.flatMap((item) => item.result?.images ?? [])[0]?.asset_id;
  const { refetch: refreshJob } = job;
  const { refetch: refreshEpisode } = episode;
  useEffect(() => {
    if (!open || !trial.data || finished) return;
    const timer = window.setInterval(() => {
      void refreshJob();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [open, trial.data, finished, refreshJob]);
  useEffect(() => {
    if (open && finished) void refreshEpisode();
  }, [open, finished, refreshEpisode]);
  const [prompt, setPrompt] = useState('');
  const [instance, setInstance] = useState('');
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [loraGroups, setLoraGroups] = useState<WorkflowLoraGroup[]>([]);
  const [loraOverrides, setLoraOverrides] = useState<WorkflowLoraGroupOverride[]>([]);
  const loraQuery = useQuery({
    queryKey: ['workflow-loras', workflowId],
    enabled: open,
    queryFn: async () => {
      const response = await raw(`/api/workflows/${encodeURIComponent(workflowId)}/loras`);
      if (!response.ok) throw new Error('LoRA controls unavailable');
      return (await response.json()) as { groups: WorkflowLoraGroup[] };
    },
    staleTime: Infinity,
  });
  const enabled = instances.filter((item) => item.enabled);
  const instanceId = enabled.find((item) => item.id === instance)?.id ?? enabled[0]?.id ?? '';
  const uncertain = trial.isError && !(trial.error instanceof ApiError && trial.error.status < 500);
  const locked = trial.isPending || uncertain || !!trial.data;
  useEffect(() => {
    if (!loraQuery.data) return;
    setLoraGroups(loraQuery.data.groups);
    setLoraOverrides(defaultLoraOverrides(loraQuery.data.groups));
  }, [loraQuery.data]);
  const invalidSize = [width, height].some(
    (size) => size !== null && (!Number.isInteger(size) || size < 64 || size > 8192),
  );
  const submit = () => {
    if (
      submitting.current ||
      trial.isPending ||
      trial.data ||
      dirty ||
      !instanceId ||
      !prompt.trim() ||
      invalidSize
    )
      return;
    if (!uncertain || !request.current) {
      request.current = {
        instance_id: instanceId,
        prompt: prompt.trim(),
        ...(width !== null ? { width } : {}),
        ...(height !== null ? { height } : {}),
        idempotency_key: crypto.randomUUID(),
        ...(loraOverrides.length ? { slot_overrides: { groups: loraOverrides } } : {}),
      };
    }
    submitting.current = true;
    trial.mutate(request.current, {
      onSettled: () => {
        submitting.current = false;
      },
    });
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('config.workflow.trial.title', { name })}
      footer={
        trial.data ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={!finished}
              onClick={() => {
                trial.reset();
                request.current = null;
              }}
            >
              {t('config.workflow.trial.again')}
            </button>
            <Link
              className="btn primary"
              to={`/workshop/assembly?task=${encodeURIComponent(trial.data.series.id)}`}
              onClick={() => onOpenChange(false)}
            >
              {t('config.workflow.trial.view')}
            </Link>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={trial.isPending || dirty || !instanceId || !prompt.trim() || invalidSize}
            onClick={submit}
          >
            <Play size={15} />
            {trial.isPending
              ? t('config.workflow.trial.pending')
              : uncertain
                ? t('config.workflow.trial.retry')
                : t('config.workflow.trial.open')}
          </button>
        )
      }
    >
      <div className="config-form">
        {!trial.data ? (
          <fieldset disabled={locked}>
            <Field label={t('config.workflow.trial.instance')}>
              <Select
                value={instanceId}
                onChange={setInstance}
                options={enabled.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Field>
            <Field label={t('config.workflow.trial.prompt')}>
              <TextArea
                rows={4}
                value={prompt}
                onChange={setPrompt}
                placeholder={t('config.workflow.trial.placeholder')}
              />
            </Field>
            <div className="grid-2">
              <Field label={t('config.workflow.trial.width')}>
                <NumberInput
                  min={64}
                  max={8192}
                  value={width}
                  onChange={setWidth}
                  placeholder={t('config.workflow.trial.originalSize')}
                />
              </Field>
              <Field label={t('config.workflow.trial.height')}>
                <NumberInput
                  min={64}
                  max={8192}
                  value={height}
                  onChange={setHeight}
                  placeholder={t('config.workflow.trial.originalSize')}
                />
              </Field>
            </div>
            {loraGroups.length ? (
              <LoraToggleList
                groups={loraGroups}
                value={loraOverrides}
                onChange={setLoraOverrides}
                disabled={locked}
              />
            ) : null}
          </fieldset>
        ) : null}
        {!trial.data && invalidSize ? (
          <p role="alert" className="notice error">
            {t('config.workflow.trial.invalidSize')}
          </p>
        ) : null}
        {dirty ? <p className="notice warn">{t('config.workflow.trial.saveFirst')}</p> : null}
        {!instanceId ? (
          <p className="notice warn">{t('config.workflow.trial.noConnection')}</p>
        ) : null}
        {trial.isError ? (
          <div role="alert" className="notice error">
            {trial.error.message}
            {uncertain ? <p>{t('config.workflow.trial.uncertain')}</p> : null}
          </div>
        ) : null}
        {trial.data && current ? (
          <div className="config-trial-result">
            <p role="status">
              {current.state === 'queued'
                ? t('config.workflow.trial.queued')
                : current.state === 'running'
                  ? t('config.workflow.trial.generating')
                  : t(`jobs.states.${current.state}`)}
            </p>
            {!finished && !failure ? (
              <progress aria-label={t('config.workflow.trial.progress')} max={1} value={progress} />
            ) : null}
            {failure ? (
              <p role="alert" className="notice error">
                {failure}
              </p>
            ) : null}
            {asset ? (
              <img src={assetUrl(asset, 480)} alt={t('config.workflow.trial.result')} />
            ) : null}
            {current.state === 'completed' &&
            !asset &&
            !failure &&
            !episode.isFetching &&
            !episode.isError ? (
              <p className="notice warn">{t('config.workflow.trial.noImage')}</p>
            ) : null}
            {job.isError || episode.isError ? (
              <div className="notice error" role="alert">
                <p>{job.error?.message || episode.error?.message}</p>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    void refreshJob();
                    void refreshEpisode();
                  }}
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
