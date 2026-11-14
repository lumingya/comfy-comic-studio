import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  inspectCreationKit,
  kitBase64,
  MAX_KIT_BYTES,
  useImportCreationKit,
  type ProfileDestination,
} from '../../api/creationKits';
import { useInstances, useSettings } from '../../api/system';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, Modal, Select } from '../../components/ui';
import { Advanced } from '../settings/ConfigurationParts';
import { AssemblyIntents } from './assemblyIntent';
import './creation-kits.css';

/** The existing import button offers its original format and portable kits. */
export function CreationKitImport({
  label,
  legacyLabel,
  legacyAccept,
  onLegacy,
  onLegacyFile,
  disabled,
}: {
  label: string;
  legacyLabel: string;
  legacyAccept?: string;
  onLegacy?: () => void;
  onLegacyFile?: (file: File) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const kitInput = useRef<HTMLInputElement>(null);
  const legacyInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger asChild>
          <button type="button" className="btn" disabled={disabled}>
            <Icon name="download" />
            {label}
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu" align="end" sideOffset={4}>
            <Menu.Item
              className="menu-item"
              onSelect={() => (onLegacy ? onLegacy() : legacyInput.current?.click())}
            >
              {legacyLabel}
            </Menu.Item>
            <Menu.Item className="menu-item" onSelect={() => kitInput.current?.click()}>
              {t('kits.import')}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <input
        ref={legacyInput}
        hidden
        type="file"
        accept={legacyAccept}
        aria-label={legacyLabel}
        onChange={(event) => {
          const value = event.target.files?.[0];
          if (value) onLegacyFile?.(value);
          event.target.value = '';
        }}
      />
      <input
        ref={kitInput}
        hidden
        type="file"
        accept=".zip"
        aria-label={t('kits.chooseFile')}
        onChange={(event) => {
          const value = event.target.files?.[0];
          event.target.value = '';
          if (!value) return;
          if (value.size > MAX_KIT_BYTES) return toastError(new Error(t('kits.tooLarge')));
          setFile(value);
        }}
      />
      {file ? <CreationKitImportPreview file={file} onClose={() => setFile(null)} /> : null}
    </>
  );
}

type Binding = { mode: '' | 'bind' | 'unbound'; instances: string[]; cloud_channel: string };
const emptyBinding = (): Binding => ({ mode: '', instances: [], cloud_channel: '' });

export function CreationKitImportPreview({ file, onClose }: { file: File; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const inspection = useQuery({
    queryKey: ['creation-kit-inspection', id],
    queryFn: ({ signal }) => inspectCreationKit(file, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const instances = useInstances();
  const settings = useSettings();
  const importing = useImportCreationKit();
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const archive = useRef<Promise<string> | null>(null);
  const intents = useRef(new AssemblyIntents());
  const report = inspection.data;
  const local = (instances.data?.instances ?? []).filter((instance) => instance.enabled);
  const channels = settings.data?.image_channels ?? [];
  const destinations: Record<string, ProfileDestination> = {};
  let ready = !!report;
  for (const requirement of report?.external ?? []) {
    const binding = bindings[requirement.profile_id] ?? emptyBinding();
    if (binding.mode === 'unbound') destinations[requirement.profile_id] = { unbound: true };
    else if (binding.mode === 'bind') {
      const validLocal =
        binding.instances.length > 0 &&
        binding.instances.every((id) => local.some((instance) => instance.id === id));
      const validCloud = channels.some((channel) => channel.id === binding.cloud_channel);
      ready &&= (!requirement.local || validLocal) && (!requirement.cloud || validCloud);
      destinations[requirement.profile_id] = {
        ...(requirement.local ? { instances: binding.instances } : {}),
        ...(requirement.cloud ? { cloud_channel: binding.cloud_channel } : {}),
      };
    } else ready = false;
  }
  const key = intents.current.keyFor('import', { sha256: report?.sha256, profiles: destinations });
  const busy = reading || importing.isPending;
  const change = (id: string, patch: Partial<Binding>) => {
    setBindings((current) => ({
      ...current,
      [id]: { ...(current[id] ?? emptyBinding()), ...patch },
    }));
    setError(null);
  };
  const submit = async () => {
    if (!ready || busy) return;
    setReading(true);
    setError(null);
    try {
      archive.current ??= kitBase64(file).catch((failure) => {
        archive.current = null;
        throw failure;
      });
      const archive_base64 = await archive.current;
      const result = await importing.mutateAsync({
        archive_base64,
        profiles: destinations,
        idempotency_key: key,
      });
      toast(t(result.unbound_profile_ids.length ? 'kits.importedUnbound' : 'kits.imported'));
      onClose();
      navigate(`/workshop/assembly?new=1&kit=${encodeURIComponent(result.series_id)}`);
    } catch (failure) {
      setError(failure);
    } finally {
      setReading(false);
    }
  };
  return (
    <Modal
      open
      size="lg"
      title={t('kits.inspectTitle', { name: report?.title ?? file.name })}
      description={t('kits.inspectHint')}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
          >
            {busy ? t('config.saving') : t('kits.confirm')}
          </button>
        </>
      }
    >
      <div className="creation-kit-form">
        {inspection.isPending ? (
          <Loading />
        ) : inspection.isError ? (
          <QueryError error={inspection.error} onRetry={inspection.refetch} />
        ) : report ? (
          <>
            <p>
              {t('kits.summary', {
                episodes: report.episodes.length,
                presets: report.presets.length,
                assets: report.asset_count,
              })}
            </p>
            <Advanced title={t('kits.contents')}>
              <strong>{t('kits.episodes')}</strong>
              <ul>
                {report.episodes.map((episode) => (
                  <li key={episode.id}>
                    {episode.title} · {t('kits.frames', { count: episode.panels })}
                  </li>
                ))}
              </ul>
              <strong>{t('kits.presets')}</strong>
              <ul>
                {report.presets.map((preset) => (
                  <li key={preset.id}>{preset.title}</li>
                ))}
              </ul>
              <strong>{t('kits.workflows')}</strong>
              <ul>
                {report.workflows.map((workflow) => (
                  <li key={workflow.id}>{workflow.name}</li>
                ))}
              </ul>
              {report.warnings.map((warning, i) => (
                <p className="small muted" key={i}>
                  {warning}
                </p>
              ))}
            </Advanced>
            {instances.isError ? (
              <QueryError error={instances.error} onRetry={instances.refetch} />
            ) : null}
            {settings.isError ? (
              <QueryError error={settings.error} onRetry={settings.refetch} />
            ) : null}
            <fieldset disabled={busy} className="creation-kit-bindings">
              <legend>{t('kits.binding')}</legend>
              {report.external.map((requirement) => {
                const binding = bindings[requirement.profile_id] ?? emptyBinding();
                const name =
                  report.profiles.find((profile) => profile.id === requirement.profile_id)?.name ??
                  requirement.profile_id;
                return (
                  <section key={requirement.profile_id} className="creation-kit-profile">
                    <Field label={name}>
                      <Select
                        value={binding.mode}
                        onChange={(mode) =>
                          change(requirement.profile_id, {
                            mode: mode as Binding['mode'],
                            instances: [],
                            cloud_channel: '',
                          })
                        }
                        options={[
                          { value: '', label: t('kits.chooseBinding') },
                          { value: 'unbound', label: t('kits.unbound') },
                          { value: 'bind', label: t('kits.bind') },
                        ]}
                      />
                    </Field>
                    {binding.mode === 'unbound' ? (
                      <p className="small muted">{t('kits.unboundHint')}</p>
                    ) : null}
                    {binding.mode === 'bind' && requirement.local ? (
                      <fieldset>
                        <legend>{t('kits.local')}</legend>
                        {local.length ? (
                          local.map((instance) => (
                            <label className="creation-kit-check" key={instance.id}>
                              <input
                                type="checkbox"
                                checked={binding.instances.includes(instance.id)}
                                onChange={(event) =>
                                  change(requirement.profile_id, {
                                    instances: event.target.checked
                                      ? [...binding.instances, instance.id]
                                      : binding.instances.filter((id) => id !== instance.id),
                                  })
                                }
                              />
                              {instance.name}
                            </label>
                          ))
                        ) : (
                          <p className="small muted">{t('kits.noLocal')}</p>
                        )}
                      </fieldset>
                    ) : null}
                    {binding.mode === 'bind' && requirement.cloud ? (
                      <Field label={t('kits.cloud')}>
                        <Select
                          value={binding.cloud_channel}
                          onChange={(cloud_channel) =>
                            change(requirement.profile_id, { cloud_channel })
                          }
                          options={[
                            { value: '', label: t('kits.chooseCloud') },
                            ...channels.map((channel) => ({
                              value: channel.id,
                              label: channel.label || channel.id,
                            })),
                          ]}
                        />
                        {!channels.length ? (
                          <p className="small muted">{t('kits.noCloud')}</p>
                        ) : null}
                      </Field>
                    ) : null}
                  </section>
                );
              })}
            </fieldset>
          </>
        ) : null}
        {error ? <QueryError error={error} /> : null}
      </div>
    </Modal>
  );
}
