import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePatchSettings, useSettings } from '../../api/system';
import type { AppSettings } from '../../api/types';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, NumberInput, TagInput, TextInput } from '../../components/ui';
import {
  Advanced,
  ConfigurationGuard,
  ConfigurationSaveBar,
  SecretInput,
  validHttpUrl,
} from './ConfigurationParts';
import { ModelCatalog } from './ModelCatalog';

const editable = (s: AppSettings) => ({
  llm: s.llm,
  guard_terms: s.guard_terms,
  trash_days: s.trash_days,
});

export function GeneralSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  if (settings.isError) return <QueryError error={settings.error} onRetry={settings.refetch} />;
  if (!settings.data) return <Loading />;
  const d = draft ?? settings.data;
  const llm = (change: Partial<AppSettings['llm']>) =>
    setDraft({ ...d, llm: { ...d.llm, ...change } });
  const dirty =
    !!draft && JSON.stringify(editable(draft)) !== JSON.stringify(editable(settings.data));
  const invalid = !validHttpUrl(d.llm.base_url);
  const modelRequest = { kind: 'openai', base_url: d.llm.base_url, api_key: d.llm.api_key };
  return (
    <form
      className="config-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || patch.isPending) return;
        patch.mutate(
          { ...editable(d), llm: { ...d.llm, base_url: d.llm.base_url.trim() } },
          {
            onSuccess: () => {
              setDraft(null);
              toast(t('common.saved'));
            },
            onError: toastError,
          },
        );
      }}
    >
      <ConfigurationGuard dirty={dirty} />
      <fieldset disabled={patch.isPending}>
        <div className="config-section-head">
          <div>
            <h2>{t('settings.llm')}</h2>
          </div>
        </div>
        <div className="grid-2">
          <Field label={t('settings.baseUrl')} hint={t('config.general.addressHint')}>
            <TextInput
              mono
              type="url"
              value={d.llm.base_url}
              onChange={(base_url) => llm({ base_url })}
              placeholder="https://…/v1"
            />
          </Field>
          <Field
            label={t('settings.apiKey')}
            hint={d.llm.api_key === '••••••' ? undefined : t('config.cloud.keyHint')}
          >
            <SecretInput value={d.llm.api_key} onChange={(api_key) => llm({ api_key })} />
          </Field>
        </div>
        <div className="config-model-field">
          <Field label={t('settings.textModels')} hint={t('config.general.modelsHint')}>
            <TagInput value={d.llm.text_models} onChange={(text_models) => llm({ text_models })} />
          </Field>
          <ModelCatalog
            request={modelRequest}
            disabled={invalid}
            selected={d.llm.text_models}
            onSelect={(id) => llm({ text_models: [...new Set([...d.llm.text_models, id])] })}
          />
        </div>
        <Advanced title={t('config.general.models')}>
          <div className="config-model-field">
            <Field label={t('config.general.visionModels')} hint={t('config.general.visionHint')}>
              <TagInput
                value={d.llm.vision_models}
                onChange={(vision_models) => llm({ vision_models })}
              />
            </Field>
            <ModelCatalog
              request={modelRequest}
              disabled={invalid}
              selected={d.llm.vision_models}
              onSelect={(id) => llm({ vision_models: [...new Set([...d.llm.vision_models, id])] })}
            />
          </div>
          <div className="config-model-field">
            <Field label={t('settings.imageModels')} hint={t('config.general.imageHint')}>
              <TagInput
                value={d.llm.image_models}
                onChange={(image_models) => llm({ image_models })}
              />
            </Field>
            <ModelCatalog
              request={modelRequest}
              disabled={invalid}
              selected={d.llm.image_models}
              onSelect={(id) => llm({ image_models: [...new Set([...d.llm.image_models, id])] })}
            />
          </div>
          <Link className="btn ghost sm" to="/engine?tab=channels">
            {t('config.profile.manageChannels')}
          </Link>
        </Advanced>
        <Advanced title={t('config.general.request')}>
          <div className="grid-2">
            <Field label={t('settings.timeout')}>
              <NumberInput
                value={d.llm.timeout}
                min={5}
                max={1800}
                onChange={(value) => llm({ timeout: value ?? 240 })}
              />
            </Field>
            <Field label={t('settings.pace')}>
              <NumberInput
                value={d.llm.pace}
                min={0}
                max={60}
                step={0.5}
                onChange={(value) => llm({ pace: value ?? 0 })}
              />
            </Field>
          </div>
        </Advanced>
        <Advanced title={t('settings.safety')}>
          <Field label={t('settings.guardTerms')} hint={t('settings.guardHint')}>
            <TagInput
              value={d.guard_terms}
              onChange={(guard_terms) => setDraft({ ...d, guard_terms })}
            />
          </Field>
          <Field label={t('settings.trashDays')}>
            <NumberInput
              value={d.trash_days}
              min={1}
              max={3650}
              onChange={(value) => setDraft({ ...d, trash_days: value ?? 30 })}
            />
          </Field>
        </Advanced>
        {invalid ? (
          <p className="notice error" role="alert">
            {t('config.invalidUrl')}
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
