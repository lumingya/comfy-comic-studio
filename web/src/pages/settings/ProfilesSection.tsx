import { ArrowDown, ArrowUp, Cloud, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useDeleteProfile,
  useInstances,
  useProfiles,
  useSaveProfile,
  useSettings,
  useWorkflows,
} from '../../api/system';
import type { RenderProfile, RenderStage, WorkflowSummary } from '../../api/types';
import { QueryError } from '../../app/errors';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import {
  Empty,
  Field,
  Loading,
  NumberInput,
  Select,
  Switch,
  TagInput,
  TextInput,
} from '../../components/ui';
import { rid } from '../bible/BibleTab';
import {
  Advanced,
  ConfigurationGuard,
  ConfigurationSaveBar,
  useDiscardChanges,
} from './ConfigurationParts';

const KINDS = ['generate', 'refine', 'upscale', 'face'] as const;

function newStage(kind: RenderStage['kind'], workflow_id = ''): RenderStage {
  return {
    id: rid('stage'),
    kind,
    workflow_id,
    variant: null,
    values: {},
    overrides: {},
    enabled: true,
    feed: 'previous',
  };
}

export function newProfile(name: string, workflow = '', cloud = false): RenderProfile {
  const now = new Date().toISOString();
  return {
    id: rid('profile'),
    name,
    dialect: cloud ? 'natural' : 'tags',
    draft: cloud ? [] : [newStage('generate', workflow)],
    final: [],
    edits: {},
    candidates: 1,
    instances: [],
    base_width: 832,
    quality_tags: null,
    negative_tags: null,
    cloud_shape: cloud,
    model_group: null,
    cloud_channel: '',
    created_at: now,
    updated_at: now,
  };
}

function StageRow({
  stage: s,
  workflows,
  onChange,
  onMove,
  first,
  last,
}: {
  stage: RenderStage;
  workflows: WorkflowSummary[];
  onChange: (stage: RenderStage | null) => void;
  onMove: (direction: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const { t } = useTranslation();
  const wf = workflows.find((w) => w.id === s.workflow_id);
  return (
    <div className="config-stage">
      <div className="stage-row config-stage-main">
        <Select
          aria-label={t('config.profile.stageKind')}
          value={s.kind}
          options={[
            ...KINDS.map((value) => ({ value, label: t(`settings.kinds.${value}`) })),
            ...((KINDS as readonly string[]).includes(s.kind)
              ? []
              : [{ value: s.kind, label: s.kind }]),
          ]}
          onChange={(kind) => onChange({ ...s, kind })}
        />
        <Select
          aria-label={t('config.profile.workflow')}
          value={s.workflow_id}
          options={[
            { value: '', label: t('config.profile.chooseWorkflow') },
            ...(!wf && s.workflow_id
              ? [{ value: s.workflow_id, label: t('config.missing', { id: s.workflow_id }) }]
              : []),
            ...workflows.map((w) => ({ value: w.id, label: w.name })),
          ]}
          onChange={(workflow_id) => onChange({ ...s, workflow_id, variant: null })}
        />
        <div className="row config-stage-actions">
          <button
            type="button"
            className="btn ghost icon sm"
            disabled={first}
            aria-label={t('config.profile.moveUp')}
            onClick={() => onMove(-1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="btn ghost icon sm"
            disabled={last}
            aria-label={t('config.profile.moveDown')}
            onClick={() => onMove(1)}
          >
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            className="btn ghost icon sm danger"
            aria-label={t('common.remove')}
            onClick={() => onChange(null)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <Advanced
        title={t('config.profile.stageAdvanced')}
        hint={!s.enabled ? t('config.profile.disabledStage') : undefined}
      >
        <div className="grid-2">
          <Field label={t('config.workflow.variant')}>
            <Select
              value={s.variant ?? ''}
              options={[
                { value: '', label: t('common.auto') },
                ...(wf?.variants ?? []).map((value) => ({ value, label: value })),
                ...(s.variant && !wf?.variants.includes(s.variant)
                  ? [{ value: s.variant, label: t('config.missing', { id: s.variant }) }]
                  : []),
              ]}
              onChange={(value) => onChange({ ...s, variant: value || null })}
            />
          </Field>
          <Field label={t('config.profile.feed')}>
            <Select
              value={s.feed}
              options={[
                { value: 'previous', label: t('settings.feedPrev') },
                { value: 'none', label: t('settings.feedNone') },
              ]}
              onChange={(feed) => onChange({ ...s, feed })}
            />
          </Field>
        </div>
        <Switch
          checked={s.enabled}
          onChange={(enabled) => onChange({ ...s, enabled })}
          label={t('settings.enabled')}
        />
        {Object.keys(s.values).length || Object.keys(s.overrides).length ? (
          <p className="small muted">{t('config.profile.preservedValues')}</p>
        ) : null}
      </Advanced>
    </div>
  );
}

function StageList({
  label,
  stages,
  workflows,
  onChange,
}: {
  label: string;
  stages: RenderStage[];
  workflows: WorkflowSummary[];
  onChange: (stages: RenderStage[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="col config-stages" aria-label={label}>
      <h3>{label}</h3>
      {stages.map((s, i) => (
        <StageRow
          key={s.id}
          stage={s}
          workflows={workflows}
          first={i === 0}
          last={i === stages.length - 1}
          onMove={(direction) => {
            const next = [...stages];
            [next[i], next[i + direction]] = [next[i + direction], next[i]];
            onChange(next);
          }}
          onChange={(next) =>
            onChange(
              next ? stages.map((x, j) => (j === i ? next : x)) : stages.filter((_, j) => j !== i),
            )
          }
        />
      ))}
      <div>
        <button
          type="button"
          className="btn sm"
          onClick={() => onChange([...stages, newStage(stages.length ? 'refine' : 'generate')])}
        >
          <Plus size={13} />
          {t('settings.addStage')}
        </button>
      </div>
    </section>
  );
}

function ProfileEditor({
  profile,
  isNew,
  onDone,
  onDirty,
}: {
  profile: RenderProfile;
  isNew: boolean;
  onDone: (id: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflows();
  const instances = useInstances();
  const settings = useSettings();
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const [draft, setDraft] = useState<RenderProfile | null>(null);
  const p = draft ?? profile;
  const dirty = isNew || (!!draft && JSON.stringify(draft) !== JSON.stringify(profile));
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const set = (change: Partial<RenderProfile>) => setDraft({ ...p, ...change });
  const channels = settings.data?.image_channels ?? [];
  const missingChannel = !!p.cloud_channel && !channels.some((c) => c.id === p.cloud_channel);
  const channelOptions = [
    { value: '', label: t('settings.channels.default') },
    ...channels.map((c) => ({ value: c.id, label: c.label || c.id })),
    ...(missingChannel
      ? [{ value: p.cloud_channel, label: t('config.missing', { id: p.cloud_channel }) }]
      : []),
  ];
  // Only the stages edited here are validated; other stored stages are kept as they are.
  const missingWorkflow = (p.cloud_shape ? [] : p.draft).some(
    (s) => !(workflows.data ?? []).some((w) => w.id === s.workflow_id),
  );
  const noStages = !p.cloud_shape && !p.draft.some((s) => s.enabled);
  const invalid =
    !p.name.trim() ||
    missingWorkflow ||
    missingChannel ||
    noStages ||
    p.candidates < 1 ||
    p.candidates > 16;
  const pending = save.isPending || remove.isPending;
  const submit = () => {
    if (invalid || pending) return;
    save.mutate(
      { profile: { ...p, name: p.name.trim() }, isNew },
      {
        onSuccess: () => {
          setDraft(null);
          toast(t('common.saved'));
          onDone(p.id);
        },
        onError: toastError,
      },
    );
  };
  const wfList = workflows.data ?? [];

  return (
    <form
      className="config-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={pending}>
        <div className="config-section-head">
          <Field label={t('common.name')}>
            <TextInput value={p.name} onChange={(name) => set({ name })} />
          </Field>
          {!isNew ? (
            <button
              type="button"
              className="btn ghost icon danger"
              aria-label={t('common.delete')}
              disabled={p.id === 'profile_default'}
              title={
                p.id === 'profile_default'
                  ? t('config.profile.defaultProtected')
                  : t('common.delete')
              }
              onClick={async () => {
                if (
                  await confirm({
                    title: t('config.profile.deleteTitle', { name: p.name }),
                    description: t('config.profile.deleteHint'),
                    confirmLabel: t('common.delete'),
                    danger: true,
                  })
                )
                  remove.mutate(p.id, { onSuccess: () => onDone(''), onError: toastError });
              }}
            >
              <Trash2 size={15} />
            </button>
          ) : null}
        </div>
        <div className="grid-2">
          <Field label={t('config.profile.route')}>
            <Select
              value={p.cloud_shape ? 'cloud' : 'local'}
              onChange={(value) => set({ cloud_shape: value === 'cloud' })}
              options={[
                { value: 'local', label: t('config.profile.local') },
                { value: 'cloud', label: t('config.profile.cloud') },
              ]}
            />
          </Field>
          <Field label={t('board.candidates')} hint={t('config.profile.candidatesHint')}>
            <NumberInput
              value={p.candidates}
              min={1}
              max={16}
              onChange={(value) => set({ candidates: value ?? 1 })}
            />
          </Field>
        </div>
        {p.cloud_shape ? (
          <>
            <Field label={t('settings.cloudChannel')} hint={t('config.profile.cloudHint')}>
              <Select
                value={p.cloud_channel}
                onChange={(cloud_channel) => set({ cloud_channel })}
                options={channelOptions}
              />
            </Field>
            <p className="notice warn">{t('config.profile.cloudBilling')}</p>
            <Link className="btn ghost sm" to="/engine?tab=channels">
              {t('config.profile.manageChannels')}
            </Link>
          </>
        ) : (
          <StageList
            label={t('config.profile.mainStages')}
            stages={p.draft}
            workflows={wfList}
            onChange={(draft) => set({ draft })}
          />
        )}
        {workflows.isError ? (
          <QueryError error={workflows.error} onRetry={workflows.refetch} />
        ) : null}
        {settings.isError ? <QueryError error={settings.error} onRetry={settings.refetch} /> : null}
        <Advanced title={t('config.profile.promptAdvanced')} hint={t('config.profile.promptHint')}>
          <div className="grid-2">
            <Field label={t('settings.dialect')}>
              <Select
                value={p.dialect}
                options={[
                  { value: 'tags', label: t('config.profile.tags') },
                  { value: 'natural', label: t('config.profile.natural') },
                ]}
                onChange={(dialect) => set({ dialect })}
              />
            </Field>
            {!p.cloud_shape ? (
              <Field label={t('settings.baseWidth')} hint={t('config.profile.widthHint')}>
                <NumberInput
                  value={p.base_width}
                  min={256}
                  max={4096}
                  step={64}
                  onChange={(value) => set({ base_width: value ?? 832 })}
                />
              </Field>
            ) : null}
          </div>
          <Field label={t('settings.qualityTags')}>
            <TagInput
              value={p.quality_tags ?? []}
              onChange={(value) => set({ quality_tags: value.length ? value : null })}
              placeholder={t('common.auto')}
            />
          </Field>
          <Field label={t('settings.negativeTags')}>
            <TagInput
              value={p.negative_tags ?? []}
              onChange={(value) => set({ negative_tags: value.length ? value : null })}
              placeholder={t('common.auto')}
            />
          </Field>
          <Field label={t('settings.modelGroup')} hint={t('settings.modelGroupHint')}>
            <TextInput
              mono
              value={p.model_group ?? ''}
              onChange={(value) => set({ model_group: value || null })}
            />
          </Field>
          <div>
            <h3>{t('settings.instances')}</h3>
            <p className="small muted">{t('config.profile.instancesHint')}</p>
            {(instances.data?.instances ?? []).map((instance) => (
              <label className="config-check" key={instance.id}>
                <input
                  type="checkbox"
                  checked={p.instances.includes(instance.id)}
                  onChange={(event) =>
                    set({
                      instances: event.target.checked
                        ? [...p.instances, instance.id]
                        : p.instances.filter((id) => id !== instance.id),
                    })
                  }
                />
                {instance.name}{' '}
                <small className="muted">
                  {instance.enabled ? instance.base_url : t('config.instance.disabled')}
                </small>
              </label>
            ))}
            {p.instances
              .filter(
                (id) => !(instances.data?.instances ?? []).some((instance) => instance.id === id),
              )
              .map((id) => (
                <button
                  type="button"
                  key={id}
                  className="btn sm danger"
                  onClick={() => set({ instances: p.instances.filter((value) => value !== id) })}
                >
                  {t('config.missing', { id })} · {t('common.remove')}
                </button>
              ))}
            {instances.isError ? (
              <QueryError error={instances.error} onRetry={instances.refetch} />
            ) : null}
          </div>
        </Advanced>
        {(missingWorkflow || missingChannel || noStages) &&
        !workflows.isLoading &&
        !settings.isLoading ? (
          <div role="alert" className="notice warn">
            {missingWorkflow
              ? t('config.profile.missingWorkflow')
              : missingChannel
                ? t('config.profile.missingChannel')
                : t('config.profile.noStages')}
          </div>
        ) : null}
      </fieldset>
      <ConfigurationSaveBar
        dirty={dirty}
        pending={pending}
        invalid={
          invalid ||
          workflows.isLoading ||
          settings.isLoading ||
          workflows.isError ||
          settings.isError
        }
        onCancel={() => {
          setDraft(null);
          if (isNew) onDone('');
        }}
      />
    </form>
  );
}

export function ProfilesSection() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const workflows = useWorkflows();
  const discard = useDiscardChanges();
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState<RenderProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const list = profiles.data ?? [];
  const current = creating ?? list.find((p) => p.id === selected) ?? list[0];
  const create = async (cloud = false) => {
    if (await discard(dirty)) {
      setDirty(false);
      setCreating(
        newProfile(
          t(cloud ? 'config.profile.newCloudName' : 'settings.newProfile'),
          workflows.data?.[0]?.id,
          cloud,
        ),
      );
    }
  };
  return (
    <section className="config-form">
      <ConfigurationGuard dirty={dirty} />
      <div className="config-section-head">
        <div>
          <h2>{t('config.profile.title')}</h2>
          <p>{t('config.profile.intro')}</p>
        </div>
      </div>
      {profiles.isError ? (
        <QueryError error={profiles.error} onRetry={profiles.refetch} />
      ) : profiles.isLoading ? (
        <Loading />
      ) : (
        <div className="config-split">
          <nav className="config-rail" aria-label={t('config.profile.list')}>
            {list.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`config-rail-item ${!creating && current?.id === p.id ? 'active' : ''}`}
                aria-pressed={!creating && current?.id === p.id}
                onClick={async () => {
                  if (await discard(dirty)) {
                    setDirty(false);
                    setCreating(null);
                    setSelected(p.id);
                  }
                }}
              >
                <strong>{p.name}</strong>
                <small>
                  {p.cloud_shape ? t('config.profile.cloud') : t('config.profile.local')}
                </small>
              </button>
            ))}
            <button type="button" className="btn sm" onClick={() => void create()}>
              <Plus size={14} />
              {t('settings.newProfile')}
            </button>
            <button type="button" className="btn sm" onClick={() => void create(true)}>
              <Cloud size={14} />
              {t('config.profile.newCloud')}
            </button>
          </nav>
          <section className="config-editor">
            {current ? (
              <ProfileEditor
                key={current.id}
                profile={current}
                isNew={!!creating}
                onDirty={setDirty}
                onDone={(id) => {
                  setDirty(false);
                  setCreating(null);
                  setSelected(id);
                }}
              />
            ) : (
              <Empty>{t('config.profile.empty')}</Empty>
            )}
          </section>
        </div>
      )}
      <div className="config-next">
        <span>{t('config.profile.nextHint')}</span>
        <Link className="btn sm" to="/workshop/assembly">
          {t('config.profile.next')}
        </Link>
      </div>
    </section>
  );
}
