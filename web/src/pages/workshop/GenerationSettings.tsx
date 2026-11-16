import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useProfiles, useSettings, useWorkflows } from '../../api/system';
import type { GenerationOptions } from '../../api/workshop';
import type { Series } from '../../api/types';
import './assemble-dialog.css';

export function generationKey(value: GenerationOptions | undefined) {
  if (value?.workflow_id) return `workflow:${value.workflow_id}`;
  if (value?.cloud_channel_id) return `channel:${value.cloud_channel_id}`;
  if (value?.profile_id) return `profile:${value.profile_id}`;
  return '';
}

export function generationValid(value: GenerationOptions | undefined) {
  const count = value?.candidates ?? 1;
  return (
    !!generationKey(value) &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 16 &&
    [value?.width, value?.height].every(
      (size) => size == null || (Number.isInteger(size) && size >= 64 && size <= 8192),
    )
  );
}

export function GenerationSummary({ value }: { value: GenerationOptions | undefined }) {
  const { t } = useTranslation();
  const workflows = useWorkflows();
  const profiles = useProfiles();
  const settings = useSettings();
  const name = value?.workflow_id
    ? workflows.data?.find((item) => item.id === value.workflow_id)?.name
    : value?.cloud_channel_id
      ? settings.data?.image_channels?.find((item) => item.id === value.cloud_channel_id)?.label
      : profiles.data?.find((item) => item.id === value?.profile_id)?.name;
  return (
    <>
      <div className="designer-summary-row">
        <dt>{t('ws.generation.route')}</dt>
        <dd>{name || generationKey(value)}</dd>
      </div>
      <div className="designer-summary-row">
        <dt>{t('ws.generation.count')}</dt>
        <dd>{value?.candidates ?? 1}</dd>
      </div>
      <div className="designer-summary-row">
        <dt>{t('ws.generation.size')}</dt>
        <dd>
          {value?.width || value?.height
            ? `${value?.width ?? '—'} × ${value?.height ?? '—'}`
            : t('ws.generation.originalSize')}
        </dd>
      </div>
    </>
  );
}

/** Shared task controls. Preferences seed new tasks; the submitted values are a snapshot. */
export function GenerationSettings({
  value,
  onChange,
  defaultProfile,
  sourceDefaults,
  disabled,
  waiting = false,
  onReadyChange,
  onConfigure,
  id = 'generation',
}: {
  value: GenerationOptions | undefined;
  onChange: (value: GenerationOptions) => void;
  defaultProfile?: string | null;
  sourceDefaults?: Series['generation_defaults'];
  disabled?: boolean;
  waiting?: boolean;
  onReadyChange?: (ready: boolean) => void;
  onConfigure?: () => void;
  id?: string;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflows();
  const profiles = useProfiles();
  const settings = useSettings();
  const channels = settings.data?.image_channels ?? [];
  const selected = generationKey(value);
  const defaults = settings.data?.generation_defaults ?? {};
  const pick = (key: string) => {
    const separator = key.indexOf(':');
    const kind = key.slice(0, separator);
    const routeId = key.slice(separator + 1);
    const previous = sourceDefaults ?? defaults[key];
    onChange({
      ...(kind === 'workflow'
        ? { workflow_id: routeId }
        : kind === 'channel'
          ? { cloud_channel_id: routeId }
          : { profile_id: routeId }),
      candidates: previous?.candidates ?? 1,
      width: previous?.width ?? null,
      height: previous?.height ?? null,
    });
  };
  const initial =
    defaultProfile && profiles.data?.some((p) => p.id === defaultProfile)
      ? `profile:${defaultProfile}`
      : '';
  useEffect(() => {
    if (
      !waiting &&
      !selected &&
      initial &&
      !settings.isPending &&
      !workflows.isPending &&
      !profiles.isPending
    ) {
      pick(initial);
    }
  });
  const exists = value?.workflow_id
    ? workflows.data?.some((w) => w.id === value.workflow_id)
    : value?.cloud_channel_id
      ? channels.some((channel) => channel.id === value.cloud_channel_id)
      : profiles.data?.some((p) => p.id === value?.profile_id);
  const sized = value?.width != null || value?.height != null;
  const loading = settings.isPending || workflows.isPending || profiles.isPending;
  const pendingBinding = !!profiles.data?.find((p) => p.id === value?.profile_id)?.binding_required;
  const valid = generationValid(value);
  useEffect(() => {
    onReadyChange?.(!!exists && valid && !pendingBinding && !loading && !waiting);
  }, [exists, valid, pendingBinding, loading, waiting, onReadyChange]);
  return (
    <div className="generation-settings">
      <div className="field">
        <label className="label" htmlFor={`${id}-route`}>
          {t('ws.generation.route')}
        </label>
        <select
          id={`${id}-route`}
          value={selected}
          disabled={disabled || loading}
          onChange={(event) => pick(event.target.value)}
        >
          {!selected || !exists ? (
            <option value={selected}>
              {t(loading ? 'common.loading' : 'ws.generation.choose')}
            </option>
          ) : null}
          {workflows.data?.length ? (
            <optgroup label={t('ws.generation.workflows')}>
              {workflows.data.map((w) => (
                <option key={w.id} value={`workflow:${w.id}`}>
                  {w.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {channels.length ? (
            <optgroup label={t('ws.generation.channels')}>
              {channels.map((channel) => (
                <option key={channel.id} value={`channel:${channel.id}`}>
                  {channel.label || channel.id}
                </option>
              ))}
            </optgroup>
          ) : null}
          {profiles.data?.length ? (
            <optgroup label={t('ws.generation.profiles')}>
              {profiles.data.map((p) => (
                <option key={p.id} value={`profile:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
        {pendingBinding ? (
          <p className="help" role="status">
            {t('ws.generation.pendingBinding')}
          </p>
        ) : null}
        {!loading && !exists ? (
          <Link className="designer-configure" to="/engine?tab=workflows" onClick={onConfigure}>
            {t('ws.generation.configure')}
          </Link>
        ) : null}
      </div>
      <div className="generation-settings-row">
        <div className="field">
          <label className="label" htmlFor={`${id}-count`}>
            {t('ws.generation.count')}
          </label>
          <input
            id={`${id}-count`}
            type="number"
            min={1}
            max={16}
            step={1}
            value={value?.candidates === 0 ? '' : (value?.candidates ?? 1)}
            disabled={disabled || !exists}
            onChange={(event) =>
              onChange({
                ...value,
                candidates: Number(event.target.value),
              })
            }
            onBlur={() =>
              onChange({
                ...value,
                candidates: Math.max(1, Math.min(16, Math.floor(value?.candidates || 1))),
              })
            }
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${id}-size`}>
            {t('ws.generation.size')}
          </label>
          <select
            id={`${id}-size`}
            value={sized ? 'custom' : 'original'}
            disabled={disabled || !exists}
            onChange={(event) =>
              onChange({
                ...value,
                width: event.target.value === 'custom' ? 832 : null,
                height: event.target.value === 'custom' ? 1216 : null,
              })
            }
          >
            <option value="original">{t('ws.generation.originalSize')}</option>
            <option value="custom">{t('ws.generation.customSize')}</option>
          </select>
        </div>
      </div>
      {sized ? (
        <div className="generation-settings-row">
          {(['width', 'height'] as const).map((key) => (
            <div className="field" key={key}>
              <label className="label" htmlFor={`${id}-${key}`}>
                {t(`ws.generation.${key}`)}
              </label>
              <input
                id={`${id}-${key}`}
                type="number"
                min={64}
                max={8192}
                step={1}
                value={value?.[key] ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [key]: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </div>
          ))}
        </div>
      ) : null}
      {selected && !valid ? (
        <p className="help" role="alert">
          {t('ws.generation.invalid')}
        </p>
      ) : null}
    </div>
  );
}
