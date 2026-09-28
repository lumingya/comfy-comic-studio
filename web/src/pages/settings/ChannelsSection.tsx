import { Cloud, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePatchSettings, useProfiles, useRegistry, useSettings } from '../../api/system';
import type { ImageChannel } from '../../api/types';
import { QueryError } from '../../app/errors';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, Loading, NumberInput, Select, TextInput } from '../../components/ui';
import {
  Advanced,
  ConfigurationGuard,
  ConfigurationSaveBar,
  validHttpUrl,
} from './ConfigurationParts';

export type { ImageChannel } from '../../api/types';
const BUILTIN_KINDS = ['openai_images', 'novelai', 'chat_image'];

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
  };
}

function ChannelFields({
  channel: c,
  kinds,
  onChange,
}: {
  channel: ImageChannel;
  kinds: string[];
  onChange: (channel: ImageChannel) => void;
}) {
  const { t } = useTranslation();
  const set = (change: Partial<ImageChannel>) => onChange({ ...c, ...change });
  const novelai = c.kind === 'novelai';
  const images = c.kind === 'openai_images';
  const chat = c.kind === 'chat_image';
  const builtin = BUILTIN_KINDS.includes(c.kind);
  const base = novelai
    ? 'https://image.novelai.net'
    : chat
      ? t('config.cloud.sharedAddress')
      : 'https://api.openai.com/v1';
  const model = novelai
    ? 'nai-diffusion-4-5-full'
    : images
      ? 'gpt-image-1'
      : t('config.cloud.sharedModel');
  return (
    <>
      <div className="grid-2">
        <Field label={t('common.name')} hint={t('config.cloud.nameHint')}>
          <TextInput
            value={c.label}
            onChange={(label) => set({ label })}
            placeholder={t('config.cloud.namePlaceholder')}
          />
        </Field>
        <Field label={t('settings.channels.kind')}>
          <Select
            value={c.kind}
            onChange={(kind) => set({ kind })}
            options={kinds.map((value) => ({
              value,
              label: t(`settings.channels.kinds.${value}`, { defaultValue: value }),
            }))}
          />
        </Field>
      </div>
      <p className="config-explainer">
        {builtin ? t(`config.cloud.protocol.${c.kind}`) : t('config.cloud.extensionHint')}
      </p>
      <Field
        label={t('settings.baseUrl')}
        hint={
          chat
            ? t('config.cloud.chatAddressHint')
            : t('config.cloud.addressHint', { address: base })
        }
      >
        <TextInput
          mono
          type="url"
          value={c.base_url}
          onChange={(base_url) => set({ base_url })}
          placeholder={base}
          autoComplete="off"
        />
      </Field>
      <div className="grid-2">
        <Field
          label={t('settings.apiKey')}
          hint={
            c.api_key === '••••••'
              ? t('config.cloud.maskedKey')
              : chat
                ? t('config.cloud.chatKeyHint')
                : t('config.cloud.keyHint')
          }
        >
          <TextInput
            mono
            type="password"
            autoComplete="new-password"
            value={c.api_key}
            onChange={(api_key) => set({ api_key })}
          />
        </Field>
        <Field
          label={t('settings.channels.model')}
          hint={builtin ? t('config.cloud.modelHint', { model }) : t('config.cloud.extensionModel')}
        >
          <TextInput
            mono
            value={c.model}
            onChange={(model) => set({ model })}
            placeholder={builtin ? model : ''}
          />
        </Field>
      </div>
      {images ? (
        <div className="grid-2">
          <Field label={t('config.cloud.outputSize')} hint={t('config.cloud.sizeHint')}>
            <TextInput
              mono
              list={`size-${c.id}`}
              value={c.size}
              onChange={(size) => set({ size })}
              placeholder={t('config.cloud.providerDefault')}
            />
            <datalist id={`size-${c.id}`}>
              {['auto', '1024x1024', '1024x1536', '1536x1024'].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
          <Field label={t('config.cloud.quality')} hint={t('config.cloud.optionalHint')}>
            <TextInput
              list={`quality-${c.id}`}
              value={c.quality}
              onChange={(quality) => set({ quality })}
              placeholder={t('config.cloud.providerDefault')}
            />
            <datalist id={`quality-${c.id}`}>
              {['auto', 'low', 'medium', 'high', 'standard', 'hd'].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
        </div>
      ) : null}
      {novelai ? (
        <div className="grid-2">
          <Field label={t('settings.channels.width')} hint={t('config.cloud.multiple64')}>
            <NumberInput
              value={c.width}
              min={64}
              max={2048}
              onChange={(v) => set({ width: v ?? 832 })}
            />
          </Field>
          <Field label={t('settings.channels.height')} hint={t('config.cloud.multiple64')}>
            <NumberInput
              value={c.height}
              min={64}
              max={2048}
              onChange={(v) => set({ height: v ?? 1216 })}
            />
          </Field>
        </div>
      ) : null}
      {chat ? <p className="small muted">{t('config.cloud.noChatSize')}</p> : null}
      <Advanced
        title={t('config.cloud.advanced')}
        hint={novelai ? t('config.cloud.novelAdvancedHint') : t('config.cloud.advancedHint')}
      >
        <Field
          label={t('settings.channels.negative')}
          hint={novelai ? undefined : t('config.cloud.negativeHint')}
        >
          <TextInput value={c.negative} onChange={(negative) => set({ negative })} />
        </Field>
        {novelai ? (
          <>
            <div className="grid-2">
              <Field label={t('settings.channels.steps')}>
                <NumberInput
                  value={c.steps}
                  min={1}
                  max={50}
                  onChange={(v) => set({ steps: v ?? 28 })}
                />
              </Field>
              <Field label={t('config.cloud.scale')}>
                <NumberInput
                  value={c.scale}
                  min={0}
                  max={20}
                  step={0.1}
                  onChange={(v) => set({ scale: v ?? 5 })}
                />
              </Field>
              <Field label={t('config.cloud.sampler')}>
                <TextInput mono value={c.sampler} onChange={(sampler) => set({ sampler })} />
              </Field>
              <Field label={t('config.cloud.refStrength')}>
                <NumberInput
                  value={c.ref_strength}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => set({ ref_strength: v ?? 0.6 })}
                />
              </Field>
            </div>
          </>
        ) : null}
        <Field label={t('config.identifier')} hint={t('config.cloud.idHint')}>
          <TextInput mono readOnly value={c.id} onChange={() => undefined} />
        </Field>
      </Advanced>
    </>
  );
}

export function ChannelsSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const registry = useRegistry();
  const profiles = useProfiles();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<{ list: ImageChannel[]; current: string } | null>(null);
  const [selected, setSelected] = useState('');
  const stored = {
    list: settings.data?.image_channels ?? [],
    current: settings.data?.image_channel ?? '',
  };
  const { list, current } = draft ?? stored;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(stored);
  const active = list.find((c) => c.id === selected) ?? list[0];
  const kinds = Array.from(
    new Set([
      ...BUILTIN_KINDS,
      ...(registry.data?.cloud_adapter ?? []).map((a) => a.id),
      ...list.map((c) => c.kind),
    ]),
  );
  const duplicate = new Set(list.map((c) => c.id)).size !== list.length;
  const invalidUrl = list.some((c) => !validHttpUrl(c.base_url, true));
  const users = (profiles.data ?? []).filter((p) => p.cloud_channel === active?.id);
  const used = active && (active.id === current || users.length > 0);
  const invalidDefault = !!current && !list.some((c) => c.id === current);
  const invalid = duplicate || invalidUrl || invalidDefault;
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
          <div className="config-split">
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
                </button>
              ))}
            </nav>
            {active ? (
              <section
                className="config-editor"
                key={active.id}
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
                  onChange={(next) => edit(list.map((c) => (c.id === active.id ? next : c)))}
                />
                {used ? (
                  <p className="small muted">
                    {t('config.cloud.inUse')}
                    {users.length ? ` ${users.map((p) => p.name).join('、')}` : ''}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        )}
        <div className="config-next">
          <span>{t('config.cloud.nextHint')}</span>
          <Link className="btn sm" to="/engine?tab=profiles">
            {t('config.cloud.next')}
          </Link>
        </div>
        {duplicate ? (
          <p className="notice error" role="alert">
            {t('settings.channels.duplicate')}
          </p>
        ) : null}
        {invalidUrl ? (
          <p className="notice error" role="alert">
            {t('config.invalidUrl')}
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
        onCancel={() => setDraft(null)}
      />
    </form>
  );
}
