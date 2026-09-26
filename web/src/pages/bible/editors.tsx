import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Character, Location, Style } from '../../api/types';
import { TIMES } from '../../api/types';
import { Field, NumberInput, Select, TagInput, TextArea, TextInput } from '../../components/ui';
import { References } from './References';

type Patch<T> = (patch: Partial<T>) => void;

const GENDERS = ['female', 'male', 'nonbinary', 'unknown'] as const;

function Outfits({
  value,
  onChange,
}: {
  value: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const add = () => {
    const key = name.trim();
    if (key && !value[key]) onChange({ ...value, [key]: [] });
    setName('');
  };
  return (
    <div className="col">
      {Object.entries(value).map(([key, tags]) => (
        <div key={key} className="outfit-row">
          <span className="chip">{key}</span>
          <div className="grow">
            <TagInput value={tags} onChange={(v) => onChange({ ...value, [key]: v })} />
          </div>
          <button
            className="btn ghost icon sm"
            aria-label={t('common.remove')}
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="row">
        <TextInput
          value={name}
          onChange={setName}
          placeholder={t('bible.outfitName')}
          onEnter={add}
        />
        <button className="btn sm" onClick={add} disabled={!name.trim()}>
          <Plus size={14} /> {t('common.add')}
        </button>
      </div>
    </div>
  );
}

export function CharacterEditor({
  value,
  onChange,
}: {
  value: Character;
  onChange: Patch<Character>;
}) {
  const { t } = useTranslation();
  const outfits = value.outfits ?? {};
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid-3">
        <Field label={t('common.name')}>
          <TextInput value={value.name} onChange={(name) => onChange({ name })} />
        </Field>
        <Field label={t('bible.gender')}>
          <Select
            value={value.gender ?? 'unknown'}
            onChange={(gender) => onChange({ gender })}
            options={GENDERS.map((g) => ({ value: g, label: t(`bible.genders.${g}`) }))}
          />
        </Field>
        <Field label={t('bible.age')}>
          <NumberInput
            value={value.age}
            min={20}
            max={120}
            onChange={(age) => onChange({ age: age ?? 20 })}
          />
        </Field>
      </div>
      <Field label={t('bible.promptTags')} hint={t('bible.promptTagsHint')}>
        <TagInput
          value={value.tag_description ?? []}
          onChange={(tag_description) => onChange({ tag_description })}
        />
      </Field>
      <Field label={t('common.description')} hint={t('bible.descriptionHint')}>
        <TextArea
          rows={2}
          value={value.description ?? ''}
          onChange={(description) => onChange({ description })}
        />
      </Field>
      <Field label={t('bible.appearance')} hint={t('bible.appearanceHint')}>
        <TagInput
          value={value.appearance ?? []}
          onChange={(appearance) => onChange({ appearance })}
        />
      </Field>
      <Field label={t('bible.signature')} hint={t('bible.signatureHint')}>
        <TagInput value={value.signature ?? []} onChange={(signature) => onChange({ signature })} />
      </Field>
      <Field label={t('common.description')}>
        <TextArea
          rows={2}
          value={value.description ?? ''}
          onChange={(description) => onChange({ description })}
        />
      </Field>
      <div className="grid-2">
        <Field label={t('bible.trigger')}>
          <TextInput
            mono
            value={value.trigger ?? ''}
            onChange={(trigger) => onChange({ trigger })}
          />
        </Field>
        <Field label={t('bible.loras')}>
          <TagInput
            value={(value.loras ?? []).map((l) => l.name)}
            onChange={(names) =>
              onChange({
                loras: names.map(
                  (name) =>
                    (value.loras ?? []).find((l) => l.name === name) ?? {
                      name,
                      strength_model: 0.8,
                      strength_clip: 0.8,
                      model_family: '',
                    },
                ),
              })
            }
          />
        </Field>
      </div>
      <Field label={t('bible.outfits')}>
        <Outfits value={outfits} onChange={(o) => onChange({ outfits: o })} />
      </Field>
      <Field label={t('bible.references')} hint={t('bible.referencesHint')}>
        <References
          value={value.references ?? []}
          onChange={(references) => onChange({ references })}
          outfits={Object.keys(outfits)}
        />
      </Field>
    </div>
  );
}

export function LocationEditor({
  value,
  onChange,
}: {
  value: Location;
  onChange: Patch<Location>;
}) {
  const { t } = useTranslation();
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid-2">
        <Field label={t('common.name')}>
          <TextInput value={value.name} onChange={(name) => onChange({ name })} />
        </Field>
        <Field label={t('bible.time')}>
          <Select
            value={value.time || 'unset'}
            onChange={(v) => onChange({ time: (v === 'unset' ? '' : v) as Location['time'] })}
            options={TIMES.map((x) => ({
              value: x || 'unset',
              label: t(`script.times.${x || 'unset'}`),
            }))}
          />
        </Field>
      </div>
      <Field label={t('common.tags')}>
        <TagInput value={value.tags ?? []} onChange={(tags) => onChange({ tags })} />
      </Field>
      <Field label={t('common.description')}>
        <TextArea
          rows={2}
          value={value.description ?? ''}
          onChange={(description) => onChange({ description })}
        />
      </Field>
      <Field label={t('bible.references')}>
        <References
          value={value.references ?? []}
          onChange={(references) => onChange({ references })}
          defaultRole="reference"
        />
      </Field>
    </div>
  );
}

export function StyleEditor({ value, onChange }: { value: Style; onChange: Patch<Style> }) {
  const { t } = useTranslation();
  return (
    <div className="col" style={{ gap: 16 }}>
      <Field label={t('common.name')}>
        <TextInput value={value.name} onChange={(name) => onChange({ name })} />
      </Field>
      <Field label={t('common.tags')}>
        <TagInput
          value={value.tag_description ?? []}
          onChange={(tag_description) => onChange({ tag_description })}
        />
      </Field>
      <Field label={t('bible.negative')}>
        <TagInput value={value.negative ?? []} onChange={(negative) => onChange({ negative })} />
      </Field>
      <Field label={t('common.description')}>
        <TextArea
          rows={2}
          value={value.description ?? ''}
          onChange={(description) => onChange({ description })}
        />
      </Field>
      <Field label={t('bible.references')}>
        <References
          value={value.references ?? []}
          onChange={(references) => onChange({ references })}
          defaultRole="style"
        />
      </Field>
    </div>
  );
}

/** `{变量}` table: name → value. */
export function VariablesEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const entries = Object.entries(value);
  const add = () => {
    const key = name.trim().replace(/[{}\s]/g, '');
    if (key && !(key in value)) onChange({ ...value, [key]: '' });
    setName('');
  };
  return (
    <div className="col">
      {entries.map(([key, v]) => (
        <div key={key} className="var-row">
          <code className="mono">{`{${key}}`}</code>
          <TextInput value={v} onChange={(nv) => onChange({ ...value, [key]: nv })} />
          <button
            className="btn ghost icon sm"
            aria-label={t('common.remove')}
            onClick={() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="row">
        <TextInput mono value={name} onChange={setName} placeholder="name" onEnter={add} />
        <button className="btn sm" onClick={add} disabled={!name.trim()}>
          <Plus size={14} /> {t('common.add')}
        </button>
      </div>
    </div>
  );
}
