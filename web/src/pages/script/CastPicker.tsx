import { Check, Plus, UserRoundPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchSeries } from '../../api/series';
import type { Character, PanelCharacter, Series } from '../../api/types';
import { Avatar } from '../../components/avatar';
import { toast, toastError } from '../../components/toast';
import { TextInput } from '../../components/ui';

/** Same shape as the server's ids (`char_<12 hex>`). */
const rid = (prefix: string) =>
  `${prefix}_${Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const splitTags = (text: string) =>
  text
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export const castEntry = (character_id: string): PanelCharacter => ({
  character_id,
  outfit: '',
  expression: '',
  action: '',
  tags: [],
  position: 'unspecified',
});

/**
 * Classic character picking: one chip per character card, click to put them in the frame.
 * "New character" creates a card in place (name + look tags) so a first-time user never has to
 * visit the bible to get a consistent face.  Details (expression, outfit, part tags) live in the
 * Studio inspector.
 */
export function CastPicker(props: {
  value: PanelCharacter[];
  series: Series;
  onChange: (v: PanelCharacter[]) => void;
}) {
  const { t } = useTranslation();
  const patch = usePatchSeries(props.series.id!);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [look, setLook] = useState('');
  const chars = props.series.bible.characters;
  const on = new Set(props.value.map((c) => c.character_id));

  const toggle = (id: string) =>
    props.onChange(
      on.has(id)
        ? props.value.filter((c) => c.character_id !== id)
        : [...props.value, castEntry(id)],
    );

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    const character = {
      id: rid('char'),
      name: clean,
      gender: 'female',
      age: 20,
      appearance: [],
      description: '',
      tag_description: splitTags(look),
      signature: [],
      references: [],
      outfits: {},
      loras: [],
      trigger: '',
    } as unknown as Character;
    patch.mutate(
      { bible: { ...props.series.bible, characters: [...chars, character] } },
      {
        onSuccess: () => {
          props.onChange([...props.value, castEntry(character.id!)]);
          toast(t('classic.cast.created', { name: clean }));
          setAdding(false);
          setName('');
          setLook('');
        },
        onError: toastError,
      },
    );
  };

  return (
    <div className="cast-picker">
      <div className="cast-chips">
        {chars.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`cast-chip ${on.has(c.id!) ? 'on' : ''}`}
            aria-pressed={on.has(c.id!)}
            title={c.tag_description.join(', ') || c.name}
            onClick={() => toggle(c.id!)}
          >
            <Avatar character={c} size={22} />
            <span>{c.name}</span>
            {on.has(c.id!) ? <Check size={13} /> : <Plus size={13} className="muted" />}
          </button>
        ))}
        {!adding ? (
          <button type="button" className="cast-chip add" onClick={() => setAdding(true)}>
            <UserRoundPlus size={14} /> {t('classic.cast.new')}
          </button>
        ) : null}
      </div>
      {!chars.length && !adding ? (
        <p className="field-hint">{t('classic.cast.emptyHint')}</p>
      ) : null}
      {adding ? (
        <div className="cast-new">
          <TextInput
            autoFocus
            value={name}
            onChange={setName}
            placeholder={t('classic.cast.name')}
            aria-label={t('classic.cast.name')}
            onEnter={create}
          />
          <TextInput
            mono
            value={look}
            onChange={setLook}
            placeholder={t('classic.cast.look')}
            aria-label={t('classic.cast.look')}
            onEnter={create}
          />
          <button
            className="btn primary sm"
            disabled={!name.trim() || patch.isPending}
            onClick={create}
          >
            <Check size={13} /> {t('common.create')}
          </button>
          <button
            className="btn ghost icon sm"
            aria-label={t('common.cancel')}
            onClick={() => setAdding(false)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
