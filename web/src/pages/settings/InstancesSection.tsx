import { Activity, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useDeleteInstance,
  useInstanceHealth,
  useInstances,
  useSaveInstance,
} from '../../api/system';
import type { ComfyInstance } from '../../api/types';
import { QueryError } from '../../app/errors';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import {
  Empty,
  Field,
  Loading,
  NumberInput,
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
  validHttpUrl,
} from './ConfigurationParts';

function InstanceEditor({
  instance,
  isNew,
  onDone,
  onDirty,
}: {
  instance: ComfyInstance;
  isNew: boolean;
  onDone: (id: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const save = useSaveInstance();
  const remove = useDeleteInstance();
  const health = useInstanceHealth();
  const [draft, setDraft] = useState<ComfyInstance | null>(null);
  const d = draft ?? instance;
  const dirty = isNew || (!!draft && JSON.stringify(draft) !== JSON.stringify(instance));
  const pending = save.isPending || health.isPending || remove.isPending;
  const invalid =
    !d.name.trim() ||
    !validHttpUrl(d.base_url) ||
    d.capacity < 1 ||
    d.capacity > 8 ||
    !Number.isInteger(d.capacity);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const set = (change: Partial<ComfyInstance>) => {
    setDraft({ ...d, ...change });
    health.reset();
  };
  const persist = async () => {
    const saved = await save.mutateAsync({
      instance: { ...d, name: d.name.trim(), base_url: d.base_url.trim() },
      isNew,
    });
    setDraft(null);
    onDone(saved.id);
    return saved;
  };
  const test = async () => {
    if (pending || invalid) return;
    try {
      // Health is an ID-based API: save an edited address BEFORE testing it, not the old URL.
      const saved = dirty ? await persist() : d;
      await health.mutateAsync(saved.id);
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <form
      className="config-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || invalid) return;
        try {
          await persist();
          toast(t('common.saved'));
        } catch (error) {
          toastError(error);
        }
      }}
    >
      <fieldset disabled={pending}>
        <div className="config-section-head">
          <Field label={t('common.name')}>
            <TextInput value={d.name} onChange={(name) => set({ name })} />
          </Field>
          {!isNew ? (
            <button
              type="button"
              className="btn ghost icon danger"
              aria-label={t('common.delete')}
              onClick={async () => {
                if (
                  await confirm({
                    title: t('config.instance.deleteTitle', { name: d.name }),
                    description: t('config.instance.deleteHint'),
                    confirmLabel: t('common.delete'),
                    danger: true,
                  })
                )
                  remove.mutate(d.id, { onSuccess: () => onDone(''), onError: toastError });
              }}
            >
              <Trash2 size={15} />
            </button>
          ) : null}
        </div>
        <Field label={t('config.instance.address')} hint={t('config.instance.addressHint')}>
          <TextInput
            mono
            type="url"
            value={d.base_url}
            onChange={(base_url) => set({ base_url })}
            placeholder="http://127.0.0.1:8188"
            autoComplete="off"
          />
        </Field>
        <div className="config-toolbar">
          <button
            type="button"
            className="btn"
            disabled={invalid || pending}
            onClick={() => void test()}
          >
            <Activity size={15} />
            {health.isPending
              ? t('config.instance.checking')
              : dirty
                ? t('config.instance.saveAndTest')
                : t('config.instance.test')}
          </button>
          <Switch
            checked={d.enabled}
            onChange={(enabled) => set({ enabled })}
            label={t('config.instance.enabled')}
          />
        </div>
        {health.data ? (
          <div className={`notice ${health.data.ok ? 'ok' : 'error'}`} role="status">
            {health.data.ok ? t('config.instance.connected') : t('config.instance.failed')}
            {!health.data.ok && health.data.stats.error ? (
              <p className="small">{String(health.data.stats.error)}</p>
            ) : null}
          </div>
        ) : (
          <p className="small muted">{t('config.instance.noGeneration')}</p>
        )}
        {health.isError ? <QueryError error={health.error} onRetry={test} /> : null}
        {!validHttpUrl(d.base_url) && d.base_url ? (
          <p className="notice error" role="alert">
            {t('config.invalidUrl')}
          </p>
        ) : null}
        <Advanced title={t('config.instance.advanced')} hint={t('config.instance.advancedHint')}>
          <div className="grid-2">
            <Field label={t('settings.capacity')} hint={t('config.instance.capacityHint')}>
              <NumberInput
                value={d.capacity}
                min={1}
                max={8}
                onChange={(value) => set({ capacity: value ?? 1 })}
              />
            </Field>
            <Field label={t('common.tags')}>
              <TagInput value={d.tags} onChange={(tags) => set({ tags })} />
            </Field>
          </div>
          <Field label={t('config.identifier')}>
            <TextInput readOnly mono value={d.id} onChange={() => undefined} />
          </Field>
        </Advanced>
      </fieldset>
      <ConfigurationSaveBar
        dirty={dirty}
        pending={pending}
        invalid={invalid}
        onCancel={() => {
          setDraft(null);
          health.reset();
          if (isNew) onDone('');
        }}
      />
    </form>
  );
}

export function InstancesSection() {
  const { t } = useTranslation();
  const instances = useInstances();
  const discard = useDiscardChanges();
  const [creating, setCreating] = useState<ComfyInstance | null>(null);
  const [selected, setSelected] = useState('');
  const [dirty, setDirty] = useState(false);
  const list = instances.data?.instances ?? [];
  const active = creating ?? list.find((i) => i.id === selected) ?? list[0];
  return (
    <section className="config-form">
      <ConfigurationGuard dirty={dirty} />
      <div className="config-section-head">
        <div>
          <h2>{t('config.instance.title')}</h2>
          <p>{t('config.instance.intro')}</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (await discard(dirty)) {
              setDirty(false);
              setCreating({
                id: rid('comfy'),
                name: `ComfyUI ${list.length + 1}`,
                base_url: 'http://127.0.0.1:8188',
                enabled: true,
                capacity: 1,
                tags: [],
              });
            }
          }}
        >
          <Plus size={15} />
          {t('settings.addInstance')}
        </button>
      </div>
      {instances.isError ? (
        <QueryError error={instances.error} onRetry={instances.refetch} />
      ) : instances.isLoading ? (
        <Loading />
      ) : !active ? (
        <Empty title={t('settings.noInstances')}>{t('config.instance.emptyHint')}</Empty>
      ) : (
        <div className="config-split">
          <nav className="config-rail" aria-label={t('config.instance.list')}>
            {list.map((instance) => (
              <button
                type="button"
                key={instance.id}
                aria-pressed={!creating && active.id === instance.id}
                className={`config-rail-item ${!creating && active.id === instance.id ? 'active' : ''}`}
                onClick={async () => {
                  if (!creating && active.id === instance.id) return;
                  if (await discard(dirty)) {
                    setDirty(false);
                    setCreating(null);
                    setSelected(instance.id);
                  }
                }}
              >
                <strong>{instance.name}</strong>
                <small>
                  {instance.enabled ? instance.base_url : t('config.instance.disabled')}
                </small>
              </button>
            ))}
            {creating ? (
              <div className="config-rail-item active">
                <strong>{creating.name}</strong>
                <small>{t('config.unsaved')}</small>
              </div>
            ) : null}
          </nav>
          <section className="config-editor">
            <InstanceEditor
              key={active.id}
              instance={active}
              isNew={!!creating}
              onDirty={setDirty}
              onDone={(id) => {
                setDirty(false);
                setCreating(null);
                setSelected(id);
              }}
            />
          </section>
        </div>
      )}
      <div className="config-next">
        <span>{t('config.instance.nextHint')}</span>
        <Link className="btn sm" to="/engine?tab=workflows">
          {t('config.instance.next')}
        </Link>
      </div>
    </section>
  );
}
