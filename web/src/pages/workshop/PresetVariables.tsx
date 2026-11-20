import { useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresetEntry, PresetGroup } from '../../api/workshop';
import { Icon } from '../../app/icons';

export interface DropZone {
  'data-drop-group': string;
  isDropTarget: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/** A `<div>` that accepts dragged variable cards (the loose area). */
export function DropArea({
  zone,
  className,
  children,
  ...rest
}: {
  zone: DropZone;
  className: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const { isDropTarget, ...handlers } = zone;
  return (
    <div className={`${className}${isDropTarget ? ' is-drop-target' : ''}`} {...handlers} {...rest}>
      {children}
    </div>
  );
}

export function Group({
  group,
  entries,
  groups,
  editing,
  picked,
  onPick,
  onDragStart,
  drop,
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
  picked: Set<string>;
  onPick: (id: string, on: boolean) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  drop: DropZone;
  onRename: (title: string) => void;
  onRemove: () => void;
  onAdd: () => void;
  onEntry: (id: string, changes: Partial<PresetEntry>, now?: boolean) => void;
  onRemoveEntry: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const body = `group-body-${group.id}`;
  const { isDropTarget, ...dropHandlers } = drop;
  return (
    <section
      className={`setting-group${open ? ' is-open' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      data-group-id={group.id}
      {...dropHandlers}
    >
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
        {entries.length ? (
          <div className="character-settings-grid">
            {entries.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                groups={groups}
                picked={picked.has(e.id!)}
                onPick={onPick}
                onDragStart={onDragStart}
                onChange={onEntry}
                onRemove={() => onRemoveEntry(e.id!)}
              />
            ))}
          </div>
        ) : (
          <p className="group-empty">{t('ws.presets.groupEmpty')}</p>
        )}
      </div>
    </section>
  );
}

export function EntryCard({
  entry,
  groups,
  picked,
  onPick,
  onDragStart,
  onChange,
  onRemove,
}: {
  entry: PresetEntry;
  groups: PresetGroup[];
  picked: boolean;
  onPick: (id: string, on: boolean) => void;
  onDragStart: (id: string, e: DragEvent) => void;
  onChange: (id: string, changes: Partial<PresetEntry>, now?: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState(false);
  const [dragging, setDragging] = useState(false);
  const label = entry.label || entry.key;
  const id = `setting-${entry.id}`;
  return (
    <div
      className={`character-setting${picked ? ' is-picked' : ''}${dragging ? ' is-dragging' : ''}`}
      data-setting-key={entry.key}
    >
      <div className="character-setting-head">
        <span
          className="setting-drag-handle"
          draggable
          title={t('ws.presets.dragHint')}
          aria-hidden="true"
          onDragStart={(e) => {
            onDragStart(entry.id!, e);
            setDragging(true);
          }}
          onDragEnd={() => setDragging(false)}
        >
          <Icon name="grip" />
        </span>
        <input
          type="checkbox"
          className="setting-pick"
          checked={picked}
          aria-label={t('ws.presets.pickOf', { label })}
          title={t('ws.presets.pickTitle')}
          onChange={(e) => onPick(entry.id!, e.target.checked)}
        />
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
