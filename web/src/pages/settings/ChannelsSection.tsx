import { ResizableSplit } from '../../components/ResizableSplit';
import { Cloud, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useImageAdapters,
  usePatchSettings,
  useProfiles,
  useRegistry,
  useSettings,
} from '../../api/system';
import type { ImageChannel } from '../../api/types';
import { QueryError } from '../../app/errors';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, Loading, Select } from '../../components/ui';
import { ConfigurationGuard, ConfigurationSaveBar, validHttpUrl } from './ConfigurationParts';
import { BUILTIN_KINDS, ChannelFields } from './ChannelFields';

export type { ImageChannel } from '../../api/types';

export function newChannel(taken: string[]): ImageChannel {
  let n = 1;
  while (taken.includes(`ch${n}`)) n += 1;
  return {
    id: `ch${n}`,
    label: '',
    kind: 'openai_images',
    base_url: '',
    api_key: '',
    model: '',
    negative: '',
    width: 832,
    height: 1216,
    size: '',
    quality: '',
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral',
    ref_strength: 0.6,
    extra_options: {},
  };
}

export function ChannelsSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const registry = useRegistry();
  const adapters = useImageAdapters();
  const profiles = useProfiles();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<{ list: ImageChannel[]; current: string } | null>(null);
  const [selected, setSelected] = useState('');
  const [invalidOptions, setInvalidOptions] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const stored = {
    list: settings.data?.image_channels ?? [],
    current: settings.data?.image_channel ?? '',
  };
  const { list, current } = draft ?? stored;
  const dirty = invalidOptions || (!!draft && JSON.stringify(draft) !== JSON.stringify(stored));
  const active = list.find((c) => c.id === selected) ?? list[0];
  const kinds = Array.from(
    new Set([
      ...BUILTIN_KINDS,
      ...(registry.data?.cloud_adapter ?? []).map((a) => a.id),
      ...list.map((c) => c.kind),
    ]),
  );
  const duplicate = new Set(list.map((c) => c.id)).size !== list.length;
  const invalidUrls = list.filter((c) => !validHttpUrl(c.base_url, true));
  const invalidUrl = invalidUrls.length > 0;
  const users = (profiles.data ?? []).filter((p) => p.cloud_channel === active?.id);
  const used = active && (active.id === current || users.length > 0);
  const invalidDefault = !!current && !list.some((c) => c.id === current);
  const invalid = duplicate || invalidUrl || invalidDefault || invalidOptions;
  const edit = (next: ImageChannel[]) => setDraft({ list: next, current });

  if (settings.isError) return <QueryError error={settings.error} onRetry={settings.refetch} />;
  if (!settings.data) return <Loading />;

  const save = () => {
    if (invalid || patch.isPending) return;
    patch.mutate(
      {
        image_channels: list.map((c) => ({
          ...c,
          base_url: c.base_url.trim(),
          model: c.model.trim(),
          size: c.size.trim(),
          quality: c.quality.trim(),
        })),
        image_channel: current,
      },
      {
        onSuccess: () => {
          setDraft(null);
          setEditorRevision((revision) => revision + 1);
          toast(t('common.saved'));
        },
        onError: toastError,
      },
    );
  };
  const remove = async () => {
    if (
      !active ||
      used ||
      !(await confirm({
        title: t('config.cloud.deleteTitle', { name: active.label || active.id }),
        description: t('config.cloud.deleteHint'),
        confirmLabel: t('common.delete'),
        danger: true,
      }))
    )
      return;
    edit(list.filter((c) => c.id !== active.id));
  };

  return (
    <form
      className="config-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <ConfigurationGuard dirty={dirty} />
      <fieldset disabled={patch.isPending}>
        <div className="config-section-head">
          <div>
            <h2>{t('config.cloud.title')}</h2>
            <p>{t('config.cloud.intro')}</p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const channel = newChannel(list.map((c) => c.id));
              edit([...list, channel]);
              setSelected(channel.id);
            }}
          >
            <Plus size={15} />
            {t('settings.channels.add')}
          </button>
        </div>
        <div className="config-default">
          <Field label={t('settings.channels.default')} hint={t('config.cloud.defaultHint')}>
            <Select
              value={current}
              onChange={(value) => setDraft({ list, current: value })}
              options={[
                { value: '', label: t('config.cloud.sharedDefault') },
                ...list.map((c) => ({
                  value: c.id,
                  label:
                    c.label ||
                    `${t(`settings.channels.kinds.${c.kind}`, { defaultValue: c.kind })} · ${c.id}`,
                })),
                ...(invalidDefault
                  ? [{ value: current, label: t('config.missing', { id: current }) }]
                  : []),
              ]}
            />
          </Field>
          <Link className="btn ghost sm" to="/settings?tab=general">
            {t('config.cloud.sharedSettings')}
          </Link>
        </div>
        {!list.length ? (
          <Empty icon={<Cloud size={24} />} title={t('settings.channels.none')}>
            {t('config.cloud.emptyHint')}
          </Empty>
        ) : (
          <ResizableSplit
            className="config-split"
            storageKey="channels"
            label={t('config.cloud.list')}
          >
            <nav className="config-rail" aria-label={t('config.cloud.list')}>
              {list.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  aria-pressed={active?.id === c.id}
                  className={`config-rail-item ${active?.id === c.id ? 'active' : ''}`}
                  onClick={() => setSelected(c.id)}
                >
                  <strong>
                    {c.label || t(`settings.channels.kinds.${c.kind}`, { defaultValue: c.kind })}
                  </strong>
                  <small>
                    {t(`settings.channels.kinds.${c.kind}`, { defaultValue: c.kind })}
                    {c.id === current ? ` · ${t('config.cloud.defaultBadge')}` : ''}
                  </small>
                  {!validHttpUrl(c.base_url, true) ? (
                    <small className="danger">{t('config.cloud.invalidAddress')}</small>
                  ) : null}
                </button>
              ))}
            </nav>
            {active ? (
              <section
                className="config-editor"
                key={`${active.id}:${editorRevision}`}
                aria-label={t('config.cloud.editor')}
              >
                <div className="config-section-head">
                  <div>
                    <h3>{active.label || t('config.cloud.unnamed')}</h3>
                    <p>{t('config.cloud.notTested')}</p>
                  </div>
                  <button
                    type="button"
                    className="btn ghost icon danger"
                    aria-label={t('config.cloud.delete')}
                    title={used ? t('config.cloud.inUse') : t('config.cloud.delete')}
                    disabled={!!used || profiles.isLoading || profiles.isError}
                    onClick={() => void remove()}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <ChannelFields
                  channel={active}
                  kinds={kinds}
                  adapter={adapters.data?.find((item) => item.id === active.kind)}
                  onChange={(next) => edit(list.map((c) => (c.id === active.id ? next : c)))}
                  onInvalidChange={setInvalidOptions}
                />
                {used ? (
                  <p className="small muted">
                    {t('config.cloud.inUse')}
                    {users.length ? ` ${users.map((p) => p.name).join('、')}` : ''}
                  </p>
                ) : null}
              </section>
            ) : null}
          </ResizableSplit>
        )}
        {duplicate ? (
          <p className="notice error" role="alert">
            {t('settings.channels.duplicate')}
          </p>
        ) : null}
        {invalidUrl ? (
          <p className="notice error" role="alert">
            {t('config.cloud.invalidAddresses', {
              names: invalidUrls.map((c) => c.label || c.id).join('、'),
            })}
          </p>
        ) : null}
        {invalidDefault ? (
          <p className="notice error" role="alert">
            {t('config.cloud.missingDefault')}
          </p>
        ) : null}
      </fieldset>
      <ConfigurationSaveBar
        dirty={dirty}
        pending={patch.isPending}
        invalid={invalid}
        onCancel={() => {
          setDraft(null);
          setInvalidOptions(false);
          setEditorRevision((revision) => revision + 1);
        }}
      />
    </form>
  );
}
