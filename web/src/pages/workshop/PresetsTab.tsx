import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  localId,
  useSavePresets,
  useWorkshop,
  type Preset,
  type PresetEntry,
  type PresetGroup,
} from '../../api/workshop';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { AutoSaveGuard, useAutoDraft } from '../../app/useAutoDraft';
import { SaveState } from '../../components/SaveState';
import type { Series } from '../../api/types';
import { confirm, promptText } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import { downloadJson, pickJsonFiles, presetFromFile, presetToFile } from './files';
import { WorkshopFrame } from './WorkshopPage';

const PICK_KEY = 'mio.workshop.preset';

function blankPreset(title: string): Preset {
  const people = { id: localId('group'), title: '主角与服装' };
  const visual = { id: localId('group'), title: '画风与场景' };
  const e = (key: string, label: string, group: string): PresetEntry => ({
    id: localId('var'),
    key,
    label,
    value: '',
    hint: '',
    group_id: group,
  });
  return {
    id: localId('preset'),
    title,
    groups: [people, visual],
    entries: [
      e('character_display_name', '角色展示名 / 旁白', people.id),
      e('character', '角色名 / 提示词', people.id),
      e('outfit', '服装', people.id),
      e('style', '画风', visual.id),
      e('scene', '场景与环境', visual.id),
    ],
  };
}

/** 预设工坊: named sets of `{变量}` values, grouped, saved automatically. */
export default function PresetsTab() {
  const ws = useWorkshop();
  if (ws.error) return <QueryError error={ws.error} onRetry={ws.refetch} />;
  if (!ws.data) return <Loading />;
  return <PresetsEditor key={ws.data.id} workshop={ws.data} />;
}
function PresetsEditor({ workshop }: { workshop: Series }) {
  const { t } = useTranslation();
  const save = useSavePresets(workshop.id);
  const draft = useAutoDraft(workshop.presets, (next) => save.mutateAsync(next), 700);
  const presets = draft.value;
  const [pick, setPick] = useState(() => localStorage.getItem(PICK_KEY) ?? '');
  const [renaming, setRenaming] = useState(false);
  const cancelRename = useRef(false);
  const [editGroups, setEditGroups] = useState(false);
  // ?new=1 (help drawer / 开箱检查 「新建预设」): add a blank preset once and select it.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!presets || !params.has('new')) return;
    setParams({}, { replace: true });
    const p = blankPreset(t('ws.presets.untitled', { n: presets.length + 1 }));
    const next = [...presets, p];
    draft.change(next);
    void draft.flushAll().catch(toastError);
    setPick(p.id!);
    localStorage.setItem(PICK_KEY, p.id!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, params]);
  const commit = (next: Preset[] | ((previous: Preset[]) => Preset[]), now = false) => {
    draft.change(next);
    if (now) void draft.flushAll().catch(toastError);
  };
  const current = presets.find((p) => p.id === pick) ?? presets[0];
  const choose = (id: string) => {
    setPick(id);
    localStorage.setItem(PICK_KEY, id);
  };
  const update = (fn: (p: Preset) => Preset, now = false) =>
    commit((previous) => previous.map((p) => (p.id === current?.id ? fn(p) : p)), now);

  // Legacy workshop-new: the name is asked first (blank names are refused).
  const addPreset = async () => {
    const title = await promptText({
      title: t('ws.presets.new'),
      label: t('ws.assetName'),
      value: t('ws.presets.untitled', { n: presets.length + 1 }),
      confirmLabel: t('common.create'),
      required: true,
    });
    if (title === null) return;
    const p = blankPreset(title);
    commit([...presets, p], true);
    choose(p.id!);
  };
  const importPresets = async () => {
    try {
      const added = (await pickJsonFiles()).map(presetFromFile);
      if (!added.length) return;
      commit((previous) => [...previous, ...added], true);
      choose(added[added.length - 1].id!);
      toast(t('ws.imported', { count: added.length }));
    } catch (e) {
      toastError(e);
    }
  };

  const actions = (
    <>
      <button
        type="button"
        className="btn"
        onClick={importPresets}
        title={t('ws.presets.importHint')}
      >
        <Icon name="download" />
        {t('ws.import')}
      </button>
      <button
        type="button"
        className="btn"
        disabled={!current}
        onClick={async () => {
          try {
            await draft.flushAll();
            const latest = draft.read().find((p) => p.id === current?.id);
            if (latest) downloadJson(`${latest.title}.json`, presetToFile(latest));
          } catch (error) {
            toastError(error);
          }
        }}
      >
        <Icon name="upload" />
        {t('ws.export')}
      </button>
      <button type="button" className="btn" onClick={() => void addPreset()}>
        <Icon name="plus" />
        {t('ws.presets.new')}
      </button>
    </>
  );

  if (!current)
    return (
      <WorkshopFrame tab="presets" actions={actions}>
        <AutoSaveGuard save={draft} />
        <div className="eco-empty">
          <h3>{t('ws.presets.emptyTitle')}</h3>
          <p>{t('ws.presets.emptyBody')}</p>
        </div>
      </WorkshopFrame>
    );

  const groups = current.groups;
  const byGroup = (gid: string | null) =>
    current.entries.filter((e) => (e.group_id ?? null) === gid);
  const loose = current.entries.filter(
    (e) => !e.group_id || !groups.some((g) => g.id === e.group_id),
  );
  const setEntry = (id: string, changes: Partial<PresetEntry>, now = false) =>
    update(
      (p) => ({
        ...p,
        entries: p.entries.map((e) => (e.id === id ? { ...e, ...changes } : e)),
      }),
      now,
    );
  const addEntry = (group_id: string | null) => {
    const used = new Set(current.entries.map((e) => e.key));
    let n = current.entries.length + 1;
    while (used.has(`var${n}`)) n += 1;
    update(
      (p) => ({
        ...p,
        entries: [
          ...p.entries,
          { id: localId('var'), key: `var${n}`, label: '', value: '', hint: '', group_id },
        ],
      }),
      true,
    );
  };
  const setGroup = (id: string, changes: Partial<PresetGroup>) =>
    update((p) => ({
      ...p,
      groups: p.groups.map((g) => (g.id === id ? { ...g, ...changes } : g)),
    }));

  return (
    <WorkshopFrame tab="presets" actions={actions}>
      <AutoSaveGuard save={draft} />
      <div className="workshop-asset-head">
        <label>
          {t('ws.presets.current')}
          {renaming ? (
            <input
              autoFocus
              onFocus={() => {
                cancelRename.current = false;
              }}
              defaultValue={current.title}
              aria-label={t('ws.presets.name')}
              onBlur={(e) => {
                if (cancelRename.current) {
                  cancelRename.current = false;
                  setRenaming(false);
                  return;
                }
                const title = e.target.value.trim();
                if (title && title !== current.title) update((p) => ({ ...p, title }), true);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename.current = true;
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <select
              id="workshop-preset-select"
              value={current.id}
              onChange={(e) => choose(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </label>
        <SaveState state={draft.state} />
        {draft.state === 'error' ? (
          <button
            type="button"
            className="btn small"
            onClick={() => void draft.flushAll().catch(toastError)}
          >
            {t('common.save')}
          </button>
        ) : null}
        <div>
          <button type="button" className="btn" onClick={() => setRenaming(!renaming)}>
            <Icon name="edit" />
            {t('ws.rename')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const copy: Preset = {
                ...structuredClone(current),
                id: localId('preset'),
                title: t('ws.presets.copyOf', { title: current.title }),
              };
              commit([...presets, copy], true);
              choose(copy.id!);
            }}
          >
            <Icon name="copy" />
            {t('ws.presets.duplicate')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={presets.length < 2}
            onClick={async () => {
              if (
                !(await confirm({
                  title: t('ws.presets.removeConfirm', { title: current.title }),
                  description: t('ws.presets.removeHelp'),
                  danger: true,
                }))
              )
                return;
              const rest = presets.filter((p) => p.id !== current.id);
              commit(rest, true);
              choose(rest[0]?.id ?? '');
            }}
          >
            <Icon name="trash" />
            {t('ws.remove')}
          </button>
        </div>
      </div>
      <div className="settings-form-toolbar">
        <div className="settings-toolbar-label">
          {t('ws.presets.variables')} <span>{current.entries.length}</span>
        </div>
        <div className="settings-toolbar-actions">
          <button type="button" className="btn" onClick={() => addEntry(null)}>
            <Icon name="plus" />
            {t('ws.presets.addVar')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              update(
                (p) => ({
                  ...p,
                  groups: [
                    ...p.groups,
                    { id: localId('group'), title: t('ws.presets.newGroupName') },
                  ],
                }),
                true,
              )
            }
          >
            <Icon name="plus" />
            {t('ws.presets.newGroup')}
          </button>
          <button
            type="button"
            className={`btn${editGroups ? ' active' : ''}`}
            aria-pressed={editGroups}
            onClick={() => setEditGroups(!editGroups)}
          >
            <Icon name="edit" />
            {editGroups ? t('ws.done') : t('ws.presets.editGroups')}
          </button>
        </div>
      </div>
      <div className="settings-groups">
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            entries={byGroup(g.id!)}
            groups={groups}
            editing={editGroups}
            onRename={(title) => setGroup(g.id!, { title })}
            onRemove={() =>
              update(
                (p) => ({
                  ...p,
                  groups: p.groups.filter((x) => x.id !== g.id),
                  entries: p.entries.map((e) =>
                    e.group_id === g.id ? { ...e, group_id: null } : e,
                  ),
                }),
                true,
              )
            }
            onAdd={() => addEntry(g.id!)}
            onEntry={setEntry}
            onRemoveEntry={(id) =>
              update((p) => ({ ...p, entries: p.entries.filter((e) => e.id !== id) }), true)
            }
          />
        ))}
        <div className="setting-loose setting-cards">
          {loose.length ? (
            <div className="character-settings-grid">
              {loose.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  groups={groups}
                  onChange={setEntry}
                  onRemove={() =>
                    update((p) => ({ ...p, entries: p.entries.filter((x) => x.id !== e.id) }), true)
                  }
                />
              ))}
            </div>
          ) : (
            <p className="group-empty setting-loose-empty">{t('ws.presets.allGrouped')}</p>
          )}
        </div>
      </div>
      <details className="quiet-advanced">
        <summary>{t('ws.presets.bindings')}</summary>
        <p className="help">{t('ws.presets.bindingsHelp')}</p>
      </details>
    </WorkshopFrame>
  );
}

function Group({
  group,
  entries,
  groups,
  editing,
  onRename,
  onRemove,
  onAdd,
  onEntry,
  onRemoveEntry,
}: {
  group: PresetGroup;
  entries: PresetEntry[];
  groups: PresetGroup[];
  editing: boolean;
  onRename: (title: string) => void;
  onRemove: () => void;
  onAdd: () => void;
  onEntry: (id: string, changes: Partial<PresetEntry>, now?: boolean) => void;
  onRemoveEntry: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = `group-body-${group.id}`;
  return (
    <section className={`setting-group${open ? ' is-open' : ''}`} data-group-id={group.id}>
      <header className="setting-group-heading">
        <button
          type="button"
          className="group-toggle"
          aria-expanded={open}
          aria-controls={body}
          aria-label={
            open
              ? t('ws.presets.collapse', { title: group.title })
              : t('ws.presets.expand', { title: group.title })
          }
          onClick={() => setOpen(!open)}
        >
          <span className="group-chevron" aria-hidden="true">
            ›
          </span>
        </button>
        {editing ? (
          <input
            className="group-title-input"
            defaultValue={group.title}
            aria-label={t('ws.presets.groupName')}
            onBlur={(e) => e.target.value.trim() && onRename(e.target.value.trim())}
          />
        ) : (
          <button
            type="button"
            className="group-title"
            aria-expanded={open}
            aria-controls={body}
            onClick={() => setOpen(!open)}
          >
            {group.title}
          </button>
        )}
        <span className="setting-count">{t('ws.presets.count', { count: entries.length })}</span>
        {editing ? (
          <button type="button" className="btn small ghost group-add" onClick={onRemove}>
            <Icon name="trash" sm />
            {t('ws.presets.removeGroup')}
          </button>
        ) : (
          <button type="button" className="btn small ghost group-add" onClick={onAdd}>
            <Icon name="plus" sm />
            {t('ws.presets.addToGroup')}
          </button>
        )}
      </header>
      <div id={body} className="group-content setting-cards" hidden={!open}>
        <div className="character-settings-grid">
          {entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              groups={groups}
              onChange={onEntry}
              onRemove={() => onRemoveEntry(e.id!)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function EntryCard({
  entry,
  groups,
  onChange,
  onRemove,
}: {
  entry: PresetEntry;
  groups: PresetGroup[];
  onChange: (id: string, changes: Partial<PresetEntry>, now?: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState(false);
  const label = entry.label || entry.key;
  const id = `setting-${entry.id}`;
  return (
    <div className="character-setting" data-setting-key={entry.key}>
      <div className="character-setting-head">
        <label htmlFor={id} className="grow">
          {label}
        </label>
        <code>{`{${entry.key}}`}</code>
        <button
          type="button"
          className="ibtn"
          title={t('ws.presets.editMeta')}
          aria-label={t('ws.presets.editMeta')}
          aria-pressed={meta}
          onClick={() => setMeta(!meta)}
        >
          <Icon name="edit" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.presets.removeVar')}
          aria-label={t('ws.presets.removeVarOf', { label })}
          onClick={onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      {meta ? (
        <div className="setting-meta grid2">
          <div className="field">
            <label className="label" htmlFor={`${id}-label`}>
              {t('ws.presets.metaLabel')}
            </label>
            <input
              id={`${id}-label`}
              defaultValue={entry.label}
              onBlur={(e) => onChange(entry.id!, { label: e.target.value.trim() }, true)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-key`}>
              {t('ws.presets.metaKey')}
            </label>
            <input
              id={`${id}-key`}
              className="mono"
              defaultValue={entry.key}
              onBlur={(e) => {
                const key = e.target.value.trim().replace(/[\s{}]/g, '');
                if (key && key !== entry.key) onChange(entry.id!, { key }, true);
              }}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-group`}>
              {t('ws.presets.metaGroup')}
            </label>
            <select
              id={`${id}-group`}
              value={entry.group_id ?? ''}
              onChange={(e) => onChange(entry.id!, { group_id: e.target.value || null }, true)}
            >
              <option value="">{t('ws.presets.noGroup')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
      <textarea
        id={id}
        aria-label={label}
        value={entry.value}
        onChange={(e) => onChange(entry.id!, { value: e.target.value })}
      />
      {entry.hint ? <p className="help">{entry.hint}</p> : null}
    </div>
  );
}
