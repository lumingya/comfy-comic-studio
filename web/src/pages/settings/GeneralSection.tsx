import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchSettings, useSettings } from '../../api/system';
import type { AppSettings } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, NumberInput, Switch, TagInput, TextInput } from '../../components/ui';

/** LLM endpoint, QA voting and safety knobs. The API key comes back masked and stays masked. */
export function GeneralSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  if (!draft) return <Loading />;
  const llm = (changes: Partial<AppSettings['llm']>) =>
    setDraft({ ...draft, llm: { ...draft.llm, ...changes } });
  const qa = (changes: Partial<AppSettings['qa']>) =>
    setDraft({ ...draft, qa: { ...draft.qa, ...changes } });
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);
  const save = () =>
    patch.mutate(
      {
        llm: draft.llm,
        qa: draft.qa,
        guard_terms: draft.guard_terms,
        trash_days: draft.trash_days,
      },
      { onSuccess: () => toast(t('common.saved')), onError: toastError },
    );

  return (
    <div className="col" style={{ gap: 20 }}>
      <section className="card col" style={{ gap: 14 }}>
        <h2>{t('settings.llm')}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {t('settings.llmHint')}
        </p>
        <div className="grid-2">
          <Field label={t('settings.baseUrl')}>
            <TextInput
              mono
              value={draft.llm.base_url}
              onChange={(base_url) => llm({ base_url })}
              placeholder="https://…/v1"
            />
          </Field>
          <Field label={t('settings.apiKey')}>
            <input
              className="input mono"
              type="password"
              autoComplete="off"
              value={draft.llm.api_key}
              onChange={(e) => llm({ api_key: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('settings.textModels')}>
          <TagInput
            value={draft.llm.text_models}
            onChange={(text_models) => llm({ text_models })}
          />
        </Field>
        <Field label={t('settings.visionModels')}>
          <TagInput
            value={draft.llm.vision_models}
            onChange={(vision_models) => llm({ vision_models })}
          />
        </Field>
        <Field label={t('settings.imageModels')}>
          <TagInput
            value={draft.llm.image_models}
            onChange={(image_models) => llm({ image_models })}
          />
        </Field>
        <div className="grid-3">
          <Field label={t('settings.timeout')}>
            <NumberInput
              value={draft.llm.timeout}
              min={5}
              max={600}
              onChange={(v) => llm({ timeout: v ?? 120 })}
            />
          </Field>
          <Field label={t('settings.pace')}>
            <NumberInput
              value={draft.llm.pace}
              min={0}
              max={60}
              step={0.5}
              onChange={(v) => llm({ pace: v ?? 0 })}
            />
          </Field>
        </div>
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <h2>{t('settings.qa')}</h2>
        <div className="grid-3">
          <Field label={t('settings.votes')} hint={t('settings.votesHint')}>
            <NumberInput
              value={draft.qa.votes}
              min={1}
              max={7}
              onChange={(v) => qa({ votes: v ?? 1 })}
            />
          </Field>
        </div>
        <Switch
          checked={draft.qa.auto_adopt}
          onChange={(auto_adopt) => qa({ auto_adopt })}
          label={t('settings.autoAdopt')}
        />
        <Switch
          checked={draft.qa.faces}
          onChange={(faces) => qa({ faces })}
          label={t('settings.faces')}
        />
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <h2>{t('settings.safety')}</h2>
        <Field label={t('settings.guardTerms')} hint={t('settings.guardHint')}>
          <TagInput
            value={draft.guard_terms}
            onChange={(guard_terms) => setDraft({ ...draft, guard_terms })}
          />
        </Field>
        <div className="grid-3">
          <Field label={t('settings.trashDays')}>
            <NumberInput
              value={draft.trash_days}
              min={1}
              max={365}
              onChange={(v) => setDraft({ ...draft, trash_days: v ?? 30 })}
            />
          </Field>
        </div>
      </section>

      <div className="save-bar sticky">
        <span className="grow" />
        <button className="btn primary" disabled={!dirty || patch.isPending} onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}
