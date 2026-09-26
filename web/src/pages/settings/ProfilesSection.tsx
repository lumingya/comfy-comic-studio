import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useDeleteProfile,
  useInstances,
  useProfiles,
  useSaveProfile,
  useWorkflows,
} from '../../api/system';
import type { RenderProfile, RenderStage, WorkflowSummary } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import {
  Empty,
  Field,
  NumberInput,
  Select,
  Switch,
  TagInput,
  TextInput,
} from '../../components/ui';
import { rid } from '../bible/BibleTab';

const KINDS = ['generate', 'refine', 'upscale', 'face', 'inpaint', 'outpaint', 'edit'] as const;
const EDIT_KINDS = ['inpaint', 'outpaint', 'edit'] as const;

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
    order: [],
  } as unknown as RenderStage;
}

function StageRow(props: {
  stage: RenderStage;
  workflows: WorkflowSummary[];
  onChange: (s: RenderStage | null) => void;
}) {
  const { t } = useTranslation();
  const s = props.stage;
  const wf = props.workflows.find((w) => w.id === s.workflow_id);
  return (
    <div className="stage-row">
      <Select
        value={s.kind}
        options={KINDS.map((k) => ({ value: k, label: t(`settings.kinds.${k}`) }))}
        onChange={(kind) => props.onChange({ ...s, kind })}
      />
      <Select
        value={s.workflow_id}
        options={[
          { value: '', label: t('bible.select') },
          ...props.workflows.map((w) => ({ value: w.id, label: w.name })),
        ]}
        onChange={(workflow_id) => props.onChange({ ...s, workflow_id, variant: null })}
      />
      <Select
        value={s.variant ?? ''}
        options={[
          { value: '', label: t('common.auto') },
          ...(wf?.variants ?? []).map((v) => ({ value: v, label: v })),
        ]}
        onChange={(v) => props.onChange({ ...s, variant: v || null })}
      />
      <Select
        value={s.feed}
        options={[
          { value: 'previous', label: t('settings.feedPrev') },
          { value: 'none', label: t('settings.feedNone') },
        ]}
        onChange={(feed) => props.onChange({ ...s, feed })}
      />
      <Switch checked={s.enabled} onChange={(enabled) => props.onChange({ ...s, enabled })} />
      <button
        className="btn ghost icon sm"
        aria-label={t('common.remove')}
        onClick={() => props.onChange(null)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function StageList(props: {
  label: string;
  stages: RenderStage[];
  workflows: WorkflowSummary[];
  onChange: (s: RenderStage[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={props.label}>
      <div className="col">
        {props.stages.map((s, i) => (
          <StageRow
            key={s.id}
            stage={s}
            workflows={props.workflows}
            onChange={(next) =>
              props.onChange(
                next
                  ? props.stages.map((x, j) => (j === i ? next : x))
                  : props.stages.filter((_, j) => j !== i),
              )
            }
          />
        ))}
        <div>
          <button
            className="btn sm"
            onClick={() =>
              props.onChange([
                ...props.stages,
                newStage(props.stages.length ? 'refine' : 'generate'),
              ])
            }
          >
            <Plus size={13} /> {t('settings.addStage')}
          </button>
        </div>
      </div>
    </Field>
  );
}

function ProfileEditor({
  profile,
  isNew,
  onDone,
}: {
  profile: RenderProfile;
  isNew: boolean;
  onDone: (id: string) => void;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflows().data ?? [];
  const instances = useInstances().data?.instances ?? [];
  const save = useSaveProfile();
  const remove = useDeleteProfile();
  const [p, setP] = useState(profile);
  useEffect(() => setP(profile), [profile]);
  const set = (changes: Partial<RenderProfile>) => setP({ ...p, ...changes });

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <TextInput
          className="bare grow workspace-title"
          value={p.name}
          onChange={(name) => set({ name })}
        />
        {!isNew ? (
          <button
            className="btn ghost icon danger"
            aria-label={t('common.delete')}
            onClick={() =>
              remove.mutate(p.id, { onSuccess: () => onDone(''), onError: toastError })
            }
          >
            <Trash2 size={15} />
          </button>
        ) : null}
        <button
          className="btn primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { profile: p, isNew },
              { onSuccess: () => (toast(t('common.saved')), onDone(p.id)), onError: toastError },
            )
          }
        >
          {t('common.save')}
        </button>
      </div>
      <div className="grid-3">
        <Field label={t('settings.dialect')}>
          <Select
            value={p.dialect}
            options={[
              { value: 'tags', label: 'tags' },
              { value: 'natural', label: 'natural' },
            ]}
            onChange={(dialect) => set({ dialect })}
          />
        </Field>
        <Field label={t('board.candidates')}>
          <NumberInput
            value={p.candidates}
            min={1}
            max={16}
            onChange={(v) => set({ candidates: v ?? 1 })}
          />
        </Field>
        <Field label={t('settings.baseWidth')}>
          <NumberInput
            value={p.base_width}
            min={256}
            max={4096}
            step={64}
            onChange={(v) => set({ base_width: v ?? 832 })}
          />
        </Field>
      </div>
      <div className="grid-2">
        <Field label={t('settings.modelGroup')} hint={t('settings.modelGroupHint')}>
          <TextInput
            mono
            value={p.model_group ?? ''}
            onChange={(v) => set({ model_group: v || null })}
          />
        </Field>
        <Field label={t('settings.instances')} hint={instances.map((i) => i.id).join(', ')}>
          <TagInput
            value={p.instances}
            onChange={(ids) => set({ instances: ids })}
            placeholder={t('common.auto')}
          />
        </Field>
      </div>
      <StageList
        label={t('settings.draftStages')}
        stages={p.draft}
        workflows={workflows}
        onChange={(draft) => set({ draft })}
      />
      <StageList
        label={t('settings.finalStages')}
        stages={p.final}
        workflows={workflows}
        onChange={(final) => set({ final })}
      />
      <Field label={t('settings.editStages')}>
        <div className="grid-3">
          {EDIT_KINDS.map((k) => (
            <label key={k} className="col small soft" style={{ gap: 4 }}>
              {t(`board.kinds.${k}`)}
              <Select
                value={p.edits[k]?.workflow_id ?? ''}
                options={[
                  { value: '', label: k === 'edit' ? t('settings.cloudEdit') : t('common.none') },
                  ...workflows.map((w) => ({ value: w.id, label: w.name })),
                ]}
                onChange={(wid) => {
                  const edits = { ...p.edits };
                  if (wid) edits[k] = { ...(edits[k] ?? newStage(k)), workflow_id: wid };
                  else delete edits[k];
                  set({ edits });
                }}
              />
            </label>
          ))}
        </div>
      </Field>
      <Field label={t('settings.qualityTags')}>
        <TagInput
          value={p.quality_tags ?? []}
          onChange={(v) => set({ quality_tags: v.length ? v : null })}
          placeholder={t('common.auto')}
        />
      </Field>
      <Field label={t('settings.negativeTags')}>
        <TagInput
          value={p.negative_tags ?? []}
          onChange={(v) => set({ negative_tags: v.length ? v : null })}
          placeholder={t('common.auto')}
        />
      </Field>
      <Switch
        checked={p.cloud_shape}
        onChange={(cloud_shape) => set({ cloud_shape })}
        label={t('settings.cloudShape')}
      />
    </div>
  );
}

export function ProfilesSection() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const [selected, setSelected] = useState<string>('');
  const [creating, setCreating] = useState<RenderProfile | null>(null);
  const list = profiles.data ?? [];
  const current = creating ?? list.find((p) => p.id === selected) ?? list[0];

  const create = () =>
    setCreating({
      ...(list[0] ?? {}),
      id: rid('profile'),
      name: t('settings.newProfile'),
      draft: [newStage('generate')],
      final: [],
      edits: {},
    } as RenderProfile);

  return (
    <div className="split">
      <nav className="split-rail">
        {list.map((p) => (
          <button
            key={p.id}
            className={`rail-item ${!creating && current?.id === p.id ? 'active' : ''}`}
            onClick={() => (setCreating(null), setSelected(p.id))}
          >
            <span className="grow ellipsis">{p.name}</span>
            <span className="small muted">{p.dialect}</span>
          </button>
        ))}
        <button className="rail-item muted" onClick={create}>
          <Plus size={14} /> {t('settings.newProfile')}
        </button>
      </nav>
      <section className="split-main">
        {current ? (
          <ProfileEditor
            key={current.id}
            profile={current}
            isNew={!!creating}
            onDone={(id) => (setCreating(null), setSelected(id))}
          />
        ) : (
          <Empty>{t('common.empty')}</Empty>
        )}
      </section>
    </div>
  );
}
