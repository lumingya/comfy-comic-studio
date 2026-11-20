import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageAdapterInfo, ImageChannel } from '../../api/types';
import { Field, NumberInput, Select, Switch, TextArea, TextInput } from '../../components/ui';

export function ExtensionOptions({
  channel,
  adapter,
  onChange,
  onInvalidChange,
}: {
  channel: ImageChannel;
  adapter?: ImageAdapterInfo;
  onChange: (options: Record<string, unknown>) => void;
  onInvalidChange: (invalid: boolean) => void;
}) {
  const { t } = useTranslation();
  const properties = Object.entries(adapter?.schema.properties ?? {});
  if (!adapter) return null;
  const hasUnknownOptions = Object.keys(channel.extra_options).some(
    (key) => !adapter.schema.properties?.[key],
  );
  const structured =
    properties.length === 0 ||
    properties.some(([, property]) => ['object', 'array'].includes(property.type ?? '')) ||
    hasUnknownOptions;
  return (
    <>
      <p className="small muted">
        {adapter.title}
        {adapter.capabilities.length ? ` · ${adapter.capabilities.join(', ')}` : ''}
      </p>
      {structured ? (
        <JsonOptionEditor
          key={`${channel.id}:${adapter.id}`}
          value={channel.extra_options}
          onChange={onChange}
          onInvalidChange={onInvalidChange}
        />
      ) : (
        <>
          {properties.map(([key, property]) => {
            const value = channel.extra_options[key];
            const label = property.title || key;
            const hint = property.description || t('config.cloud.extraOptionHint');
            if (property.type === 'boolean')
              return (
                <Switch
                  key={key}
                  checked={value === true}
                  label={label}
                  onChange={(enabled) => onChange({ ...channel.extra_options, [key]: enabled })}
                />
              );
            if (property.type === 'number' || property.type === 'integer')
              return (
                <Field key={key} label={label} hint={hint}>
                  <NumberInput
                    value={typeof value === 'number' ? value : null}
                    step={property.type === 'integer' ? 1 : 0.1}
                    onChange={(next) => {
                      const options = { ...channel.extra_options };
                      if (next === null) delete options[key];
                      else options[key] = next;
                      onChange(options);
                    }}
                  />
                </Field>
              );
            if (property.type === 'string')
              return (
                <Field key={key} label={label} hint={hint}>
                  {property.enum?.length ? (
                    <Select
                      value={typeof value === 'string' ? value : ''}
                      onChange={(next) => onChange({ ...channel.extra_options, [key]: next })}
                      options={[
                        { value: '', label: t('config.cloud.providerDefault') },
                        ...property.enum.map((item) => ({ value: item, label: item })),
                      ]}
                    />
                  ) : (
                    <TextInput
                      value={typeof value === 'string' ? value : ''}
                      onChange={(next) => onChange({ ...channel.extra_options, [key]: next })}
                    />
                  )}
                </Field>
              );
            return null;
          })}
        </>
      )}
    </>
  );
}

function JsonOptionEditor({
  value,
  onChange,
  onInvalidChange,
}: {
  value: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
  onInvalidChange: (invalid: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => () => onInvalidChange(false), [onInvalidChange]);
  const validate = (invalid: boolean) => {
    setInvalid(invalid);
    onInvalidChange(invalid);
  };
  return (
    <Field label={t('config.cloud.extraOptionsJson')} hint={t('config.cloud.extraOptionHint')}>
      <TextArea
        mono
        rows={7}
        value={draft}
        onChange={(text) => {
          setDraft(text);
          try {
            const parsed: unknown = JSON.parse(text);
            if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
              validate(true);
              return;
            }
            validate(false);
            onChange(parsed as Record<string, unknown>);
          } catch {
            validate(true);
          }
        }}
      />
      {invalid ? (
        <small role="alert" className="danger">
          {t('config.cloud.extraOptionsInvalid')}
        </small>
      ) : null}
    </Field>
  );
}
