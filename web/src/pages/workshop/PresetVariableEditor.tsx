import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { localId, type Preset, type PresetEntry, type PresetGroup } from '../../api/workshop';
import { Icon } from '../../app/icons';
import { DropArea, EntryCard, Group, type DropZone } from './PresetVariables';
import type { PresetLibrary } from './presetsState';

export function PresetVariableEditor({
  current,
  update,
  addEntry,
  editGroups,
  setEditGroups,
}: {
  current: Preset;
  update: PresetLibrary['update'];
  addEntry: PresetLibrary['addEntry'];
  editGroups: boolean;
  setEditGroups: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [dropOver, setDropOver] = useState<string | null>(null);
  const dragIds = useRef<string[]>([]);
  const currentId = current?.id;
  useEffect(() => {
    setPicked(new Set());
    setMoveTarget('');
  }, [currentId]);
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
  const setGroup = (id: string, changes: Partial<PresetGroup>) =>
    update((p) => ({
      ...p,
      groups: p.groups.map((g) => (g.id === id ? { ...g, ...changes } : g)),
    }));
  const pickedHere = current.entries.filter((e) => picked.has(e.id!));
  const togglePick = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const moveEntries = (ids: string[], group_id: string | null) => {
    if (!ids.length) return;
    update(
      (p) => ({
        ...p,
        entries: p.entries.map((e) => (ids.includes(e.id!) ? { ...e, group_id } : e)),
      }),
      true,
    );
    setPicked(new Set());
  };
  const startDrag = (id: string, e: DragEvent) => {
    dragIds.current = picked.has(id) ? [...picked] : [id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragIds.current.join(','));
  };
  /** Drop-zone props for a group section (`gid`) or the loose area (`null`). */
  const dropZone = (gid: string | null): DropZone => {
    const key = gid ?? '';
    return {
      'data-drop-group': key,
      isDropTarget: dropOver === key,
      onDragOver: (e: DragEvent) => {
        if (!dragIds.current.length) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropOver !== key) setDropOver(key);
      },
      onDragLeave: (e: DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropOver((prev) => (prev === key ? null : prev));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const ids = dragIds.current;
        dragIds.current = [];
        setDropOver(null);
        moveEntries(ids, gid);
      },
    };
  };

  return (
    <>
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
      <div className={`settings-groups${pickedHere.length ? ' has-picked' : ''}`}>
        {pickedHere.length ? (
          <div
            className="setting-selection-bar"
            role="toolbar"
            aria-label={t('ws.presets.pickedActions')}
          >
            <strong>{t('ws.presets.pickedCount', { count: pickedHere.length })}</strong>
            <label className="setting-selection-target">
              <span>{t('ws.presets.moveTo')}</span>
              <select
                value={moveTarget}
                aria-label={t('ws.presets.moveTarget')}
                onChange={(e) => setMoveTarget(e.target.value)}
              >
                <option value="">{t('ws.presets.noGroup')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn small"
              onClick={() =>
                moveEntries(
                  pickedHere.map((e) => e.id!),
                  moveTarget || null,
                )
              }
            >
              <Icon name="check" sm />
              {t('ws.presets.move')}
            </button>
            <button type="button" className="btn small ghost" onClick={() => setPicked(new Set())}>
              {t('ws.presets.clearPick')}
            </button>
          </div>
        ) : null}
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            entries={byGroup(g.id!)}
            groups={groups}
            editing={editGroups}
            picked={picked}
            onPick={togglePick}
            onDragStart={startDrag}
            drop={dropZone(g.id!)}
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
        <DropArea
          className="setting-loose setting-cards"
          zone={dropZone(null)}
          aria-label={t('ws.presets.loose')}
        >
          {loose.length ? (
            <>
              {groups.length ? <p className="setting-loose-hint">{t('ws.presets.loose')}</p> : null}
              <div className="character-settings-grid">
                {loose.map((e) => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    groups={groups}
                    picked={picked.has(e.id!)}
                    onPick={togglePick}
                    onDragStart={startDrag}
                    onChange={setEntry}
                    onRemove={() =>
                      update(
                        (p) => ({ ...p, entries: p.entries.filter((x) => x.id !== e.id) }),
                        true,
                      )
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="group-empty setting-loose-empty">
              {groups.length ? t('ws.presets.allGrouped') : t('ws.presets.noVars')}
            </p>
          )}
        </DropArea>
      </div>
    </>
  );
}
