import { useTranslation } from 'react-i18next';
import type { ImageAdapterInfo, ImageChannel } from '../../api/types';
import { Field, NumberInput, Select, TextInput } from '../../components/ui';
import { Advanced, SecretInput, validHttpUrl } from './ConfigurationParts';
import { ModelCatalog } from './ModelCatalog';
import { ExtensionOptions } from './ChannelExtensionOptions';

export const BUILTIN_KINDS = ['openai_images', 'novelai', 'chat_image'];

export function ChannelFields({
  channel: c,
  kinds,
  adapter,
  onChange,
  onInvalidChange,
}: {
  channel: ImageChannel;
  kinds: string[];
  adapter?: ImageAdapterInfo;
  onChange: (channel: ImageChannel) => void;
  onInvalidChange: (invalid: boolean) => void;
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
        <Field label={t('common.name')}>
          <TextInput
            value={c.label}
            onChange={(label) => set({ label })}
            placeholder={t('config.cloud.namePlaceholder')}
          />
        </Field>
        <Field label={t('settings.channels.kind')} hint={t('config.cloud.kindHint')}>
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
      {!validHttpUrl(c.base_url, true) ? (
        <p className="notice error" role="alert">
          {t('config.invalidUrl')}
        </p>
      ) : null}
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
          <SecretInput value={c.api_key} onChange={(api_key) => set({ api_key })} />
        </Field>
        <div className="config-model-field">
          <Field
            label={t('settings.channels.model')}
            hint={
              builtin ? t('config.cloud.modelHint', { model }) : t('config.cloud.extensionModel')
            }
          >
            <TextInput
              mono
              value={c.model}
              onChange={(model) => set({ model })}
              placeholder={builtin ? model : ''}
            />
          </Field>
          <ModelCatalog
            request={{ kind: c.kind, base_url: c.base_url, api_key: c.api_key, channel_id: c.id }}
            disabled={!validHttpUrl(c.base_url, true)}
            selected={c.model ? [c.model] : []}
            onSelect={(model) => set({ model })}
          />
        </div>
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
              step={64}
              onChange={(v) => set({ width: v ?? 832 })}
            />
          </Field>
          <Field label={t('settings.channels.height')} hint={t('config.cloud.multiple64')}>
            <NumberInput
              value={c.height}
              min={64}
              max={2048}
              step={64}
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
        {!builtin ? (
          <ExtensionOptions
            channel={c}
            adapter={adapter}
            onChange={(extra_options) => set({ extra_options })}
            onInvalidChange={onInvalidChange}
          />
        ) : null}
        <Field
          label={t('settings.channels.negative')}
          hint={t(novelai ? 'config.cloud.negativeNativeHint' : 'config.cloud.negativeHint')}
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
