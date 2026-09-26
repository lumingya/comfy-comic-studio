import { MapPin, Palette, Plus, Trash2, User, Variable } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchSeries } from '../../api/series';
import type { Bible, Character, Location, Style } from '../../api/types';
import { useAutosave } from '../../app/autosave';
import { Avatar } from '../../components/avatar';
import { SaveState } from '../../components/SaveState';
import { toast, toastError } from '../../components/toast';
import { Empty } from '../../components/ui';
import { useSeriesContext } from '../series/SeriesPage';
import { CharacterEditor, LocationEditor, StyleEditor, VariablesEditor } from './editors';

type Kind = 'characters' | 'locations' | 'styles';
type Selection = { kind: Kind; id: string } | { kind: 'variables' };

/** Same shape as the server's ids (`char_<12 hex>`), so the story view treats them alike. */
export const rid = (prefix: string) =>
  `${prefix}_${Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;

function blank(kind: Kind, name: string): Character | Location | Style {
  if (kind === 'characters')
    return {
      id: rid('char'),
      name,
      gender: 'female',
      age: 25,
      appearance: [],
      description: '',
      tag_description: [],
      signature: [],
      references: [],
      outfits: {},
      loras: [],
      trigger: '',
    } as Character;
  if (kind === 'locations')
    return {
      id: rid('loc'),
      name,
      description: '',
      tags: [],
      time: '',
      references: [],
    } as Location;
  return {
    id: rid('style'),
    name,
    description: '',
    tag_description: [],
    negative: [],
    references: [],
    loras: [],
  } as Style;
}

export default function BibleTab() {
  const { t } = useTranslation();
  const { series } = useSeriesContext();
  const patch = usePatchSeries(series.id!);
  const [bible, setBible] = useState<Bible>(series.bible);
  const [variables, setVariables] = useState<Record<string, string>>(series.variables ?? {});
  const [sel, setSel] = useState<Selection | null>(() => {
    const first = series.bible.characters[0];
    return first ? { kind: 'characters', id: first.id! } : null;
  });

  const autosave = useAutosave(() => patch.mutateAsync({ bible, variables }), 1000);

  // Take the server copy (e.g. the assistant added a character) unless local edits are pending —
  // renaming the series in the header must not throw away an unsaved character.
  useEffect(() => {
    if (autosave.busy()) return;
    setBible(series.bible);
    setVariables(series.variables ?? {});
  }, [series.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: (b: Bible) => Bible) => {
    setBible(next);
    autosave.touch();
  };

  const groups: { kind: Kind; icon: ReactNode; label: string; add: string }[] = [
    {
      kind: 'characters',
      icon: <User size={14} />,
      label: t('bible.characters'),
      add: t('bible.newCharacter'),
    },
    {
      kind: 'locations',
      icon: <MapPin size={14} />,
      label: t('bible.locations'),
      add: t('bible.newLocation'),
    },
    {
      kind: 'styles',
      icon: <Palette size={14} />,
      label: t('bible.styles'),
      add: t('bible.newStyle'),
    },
  ];

  const current = useMemo(() => {
    if (!sel || sel.kind === 'variables') return null;
    return (bible[sel.kind] as { id: string }[]).find((x) => x.id === sel.id) ?? null;
  }, [bible, sel]);

  const update = (kind: Kind, id: string, changes: object) =>
    edit((b) => ({
      ...b,
      [kind]: (b[kind] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...changes } : x)),
    }));

  const add = (kind: Kind, label: string) => {
    const item = blank(kind, label);
    edit((b) => ({ ...b, [kind]: [...(b[kind] ?? []), item] }));
    setSel({ kind, id: item.id! });
  };

  const remove = (kind: Kind, id: string) => {
    const list = bible[kind] as { id: string; name: string }[];
    const index = list.findIndex((x) => x.id === id);
    const item = list[index];
    if (!item) return;
    edit((b) => ({ ...b, [kind]: (b[kind] as { id: string }[]).filter((x) => x.id !== id) }));
    setSel(null);
    toast(t('bible.deleted', { name: item.name || item.id }), {
      action: {
        label: t('common.undo'),
        onClick: () => {
          edit((b) => {
            const items = [...(b[kind] as object[])];
            items.splice(Math.min(index, items.length), 0, item);
            return { ...b, [kind]: items };
          });
          setSel({ kind, id });
        },
      },
    });
  };

  return (
    <div
      className="split"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          autosave.flush().catch(toastError);
        }
      }}
    >
      <aside className="split-rail">
        {groups.map((g) => {
          const items = bible[g.kind] as { id: string; name: string }[];
          return (
            <div key={g.kind} className="rail-group">
              <div className="rail-group-head">
                <span className="row" style={{ gap: 6 }}>
                  {g.icon} {g.label}
                  <span className="rail-count">{items.length}</span>
                </span>
                <button
                  className="btn ghost icon sm"
                  title={g.add}
                  aria-label={g.add}
                  onClick={() => add(g.kind, g.add)}
                >
                  <Plus size={14} />
                </button>
              </div>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`rail-item ${sel && 'id' in sel && sel.id === item.id ? 'active' : ''}`}
                  onClick={() => setSel({ kind: g.kind, id: item.id })}
                >
                  {g.kind === 'characters' ? (
                    <Avatar character={item as Character} size={22} />
                  ) : null}
                  <span className="ellipsis">{item.name || item.id}</span>
                </button>
              ))}
            </div>
          );
        })}
        <button
          className={`rail-item ${sel?.kind === 'variables' ? 'active' : ''}`}
          onClick={() => setSel({ kind: 'variables' })}
        >
          <Variable size={14} /> {t('bible.variables')}
        </button>
      </aside>

      <section className="split-main">
        <div className="save-bar">
          <SaveState state={autosave.state} />
          <span className="grow" />
          {current && sel && sel.kind !== 'variables' ? (
            <button className="btn ghost danger sm" onClick={() => remove(sel.kind, sel.id)}>
              <Trash2 size={14} /> {t('common.delete')}
            </button>
          ) : null}
        </div>
        {!sel ? (
          <Empty icon={<User size={24} />} title={t('bible.emptyTitle')}>
            {t('bible.select')}
          </Empty>
        ) : null}
        {sel?.kind === 'variables' ? (
          <div className="card">
            <h2>{t('bible.variables')}</h2>
            <p className="hint">{t('bible.variablesHint')}</p>
            <VariablesEditor
              value={variables}
              onChange={(v) => (setVariables(v), autosave.touch())}
            />
          </div>
        ) : null}
        {current && sel?.kind === 'characters' ? (
          <CharacterEditor
            value={current as Character}
            onChange={(c) => update('characters', sel.id, c)}
          />
        ) : null}
        {current && sel?.kind === 'locations' ? (
          <LocationEditor
            value={current as Location}
            onChange={(c) => update('locations', sel.id, c)}
          />
        ) : null}
        {current && sel?.kind === 'styles' ? (
          <StyleEditor value={current as Style} onChange={(c) => update('styles', sel.id, c)} />
        ) : null}
      </section>
    </div>
  );
}
