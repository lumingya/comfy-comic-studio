import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useSeriesList, useTrashSeries } from '../../api/series';
import { useProfiles } from '../../api/system';
import {
  PREVIEW_SUBTITLE,
  localId,
  usePreviewPreset,
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
import type { Series, SeriesCard } from '../../api/types';
import { confirm, promptText } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Loading, Modal } from '../../components/ui';
import { ContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { askAssetTitle } from './storyActions';
import { downloadJson, pickJsonFiles, presetFromFile, presetToFile } from './files';
import { WorkshopFrame } from './WorkshopPage';

const PICK_KEY = 'mio.workshop.preset';
/** Right-clicks on these keep the browser menu (legacy workshopContextSpec). */
const NATIVE_MENU =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),a[href],dialog,[role=dialog],.context-menu';

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
  const [previewing, setPreviewing] = useState(false);
  // Legacy workshopPresetContextItems: right-clicking the page (outside text fields) opens the
  // preset menu.  Bound natively on the page so it also covers the heading and the tabs.
  const headRef = useRef<HTMLDivElement>(null);
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; target: HTMLElement } | null>(
    null,
  );
  useEffect(() => {
    const host = headRef.current?.closest<HTMLElement>('.assembly-workshop');
    if (!host) return;
    const onMenu = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(NATIVE_MENU) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setPageMenu({ x: e.clientX, y: e.clientY, target });
    };
    host.addEventListener('contextmenu', onMenu);
    return () => host.removeEventListener('contextmenu', onMenu);
  }, [presets.length]);
  // Legacy settings workbench: tick cards to move several at once; drag a card (or the ticked
  // cards) by its handle into a group section or the loose area below.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [dropOver, setDropOver] = useState<string | null>(null);
  const dragIds = useRef<string[]>([]);
  const shelf = useSeriesList();
  const trashSeries = useTrashSeries();
  const navigate = useNavigate();
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
  const currentId = current?.id;
  useEffect(() => {
    setPicked(new Set());
    setMoveTarget('');
  }, [currentId]);
  // Legacy preset page: the last three 独立试绘 results of this preset (queue tasks marked as
  // previews), newest last.
  const previews = useMemo(
    () =>
      (shelf.data ?? [])
        .filter(
          (s) => s.subtitle === PREVIEW_SUBTITLE && s.presets.some((p) => p.id === current?.id),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(-3),
    [shelf.data, current?.id],
  );
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
    <WorkshopFrame tab="presets" actions={actions}>
      <AutoSaveGuard save={draft} />
      <div className="workshop-asset-head" ref={headRef}>
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
            title={t('ws.presets.previewDesc')}
            onClick={() => setPreviewing(true)}
          >
            <Icon name="brush" />
            {t('ws.presets.preview')}
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
      {previews.length ? (
        <div className="workshop-preset-preview" role="list" aria-label={t('ws.presets.previews')}>
          {previews.map((album) => (
            <PreviewFigure
              key={album.id}
              album={album}
              onOpen={() => navigate('/workshop/assembly')}
              onRemove={async () => {
                if (
                  !(await confirm({
                    title: t('ws.presets.previewRemoveConfirm', { title: album.title }),
                    description: t('ws.presets.previewRemoveHelp'),
                    confirmLabel: t('common.delete'),
                    danger: true,
                  }))
                )
                  return;
                trashSeries.mutate(album.id, { onError: toastError });
              }}
            />
          ))}
        </div>
      ) : null}
      {previewing ? (
        <PreviewDialog
          preset={current}
          onClose={() => setPreviewing(false)}
          beforeSubmit={() => draft.flushAll()}
          onQueued={(title) => {
            setPreviewing(false);
            toast(t('ws.presets.previewQueued', { title }));
            navigate('/workshop/assembly');
          }}
        />
      ) : null}
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
            <span className="setting-selection-hint">{t('ws.presets.pickHint')}</span>
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
              {groups.length ? (
                <p className="setting-loose-hint">{t('ws.presets.looseHint')}</p>
              ) : null}
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
      <details className="quiet-advanced">
        <summary>{t('ws.presets.bindings')}</summary>
        <p className="help">{t('ws.presets.bindingsHelp')}</p>
      </details>
      {pageMenu ? (
        <ContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          returnFocus={pageMenu.target}
          onClose={() => setPageMenu(null)}
          groups={presetMenuGroups()}
        />
      ) : null}
    </WorkshopFrame>
  );

  /** Legacy workshopPresetContextItems, submenus flattened into headed groups. */
  function presetMenuGroups(): ContextGroup[] {
    const p = current!;
    const go = (fn: () => Promise<unknown>) => () => void fn().catch(toastError);
    return [
      {
        heading: `${p.title} · ${t('ws.presets.count', { count: p.entries.length })}`,
        items: [
          {
            label: t('ws.presets.addVar'),
            icon: <Icon name="plus" sm />,
            primary: true,
            hint: t('ws.presets.menu.addVarHint'),
            onSelect: () => addEntry(null),
          },
          {
            label: t('ws.presets.newGroup'),
            icon: <Icon name="folder" sm />,
            onSelect: () =>
              update(
                (x) => ({
                  ...x,
                  groups: [
                    ...x.groups,
                    { id: localId('group'), title: t('ws.presets.newGroupName') },
                  ],
                }),
                true,
              ),
          },
          {
            label: editGroups ? t('ws.done') : t('ws.presets.menu.editGroupsDots'),
            icon: <Icon name="edit" sm />,
            onSelect: () => setEditGroups(!editGroups),
          },
        ],
      },
      {
        items: [
          {
            label: t('ws.presets.preview'),
            icon: <Icon name="brush" sm />,
            hint: t('ws.presets.menu.previewHint'),
            onSelect: () => setPreviewing(true),
          },
          {
            label: t('ws.presets.menu.newTaskDots'),
            icon: <Icon name="play" sm />,
            hint: t('ws.presets.menu.newTaskHint'),
            onSelect: () => navigate('/workshop/assembly?new=1'),
          },
        ],
      },
      {
        heading: t('ws.presets.menu.assetGroup'),
        items: [
          {
            label: t('ws.presets.menu.renameDots'),
            icon: <Icon name="edit" sm />,
            onSelect: go(async () => {
              const title = await askAssetTitle(p.title, t);
              if (title) update((x) => ({ ...x, title }), true);
            }),
          },
          {
            label: t('ws.presets.menu.newDots'),
            icon: <Icon name="plus" sm />,
            onSelect: () => void addPreset(),
          },
          {
            label: t('ws.presets.menu.exportThis'),
            icon: <Icon name="upload" sm />,
            onSelect: go(async () => {
              await draft.flushAll();
              const latest = draft.read().find((x) => x.id === p.id);
              if (latest) downloadJson(`${latest.title}.json`, presetToFile(latest));
            }),
          },
        ],
      },
      {
        heading: t('ws.presets.menu.libraryGroup'),
        items: [
          {
            label: t('ws.presets.menu.importDots'),
            icon: <Icon name="download" sm />,
            hint: t('ws.presets.menu.importHint'),
            onSelect: () => void importPresets(),
          },
        ],
      },
      {
        heading: t('ws.menu.switchTo'),
        items: [
          {
            label: t('ws.tab.story'),
            icon: <Icon name="story" sm />,
            onSelect: () => navigate('/workshop/story'),
          },
          {
            label: t('ws.tab.assembly'),
            icon: <Icon name="play" sm />,
            onSelect: () => navigate('/workshop/assembly'),
          },
        ],
      },
    ];
  }
}

/** One 独立试绘 result on the preset page: cover (or a waiting placeholder), title, delete. */
function PreviewFigure({
  album,
  onOpen,
  onRemove,
}: {
  album: SeriesCard;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <figure className="workshop-preview-figure" role="listitem" data-preview-id={album.id}>
      <button
        type="button"
        className="workshop-preview-open"
        title={t('ws.presets.previewOpen')}
        onClick={onOpen}
      >
        {album.cover_asset_id ? (
          <img src={assetUrl(album.cover_asset_id, 320)} alt={album.title} loading="lazy" />
        ) : (
          <span className="workshop-preview-blank">{t('ws.presets.previewPending')}</span>
        )}
      </button>
      <figcaption>{album.title}</figcaption>
      <button
        type="button"
        className="ibtn"
        title={t('ws.presets.previewRemove')}
        aria-label={t('ws.presets.previewRemove')}
        onClick={onRemove}
      >
        <Icon name="trash" />
      </button>
    </figure>
  );
}

/** Legacy 「预设独立试绘」 modal: a prompt (prefilled with the preset's variables) and the
 * workflow to use; submitting adds a one-frame standby task to the assembly queue. */
function PreviewDialog({
  preset,
  onClose,
  beforeSubmit,
  onQueued,
}: {
  preset: Preset;
  onClose: () => void;
  beforeSubmit: () => Promise<unknown>;
  onQueued: (title: string) => void;
}) {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const preview = usePreviewPreset();
  const [prompt, setPrompt] = useState(() => preset.entries.map((e) => `{${e.key}}`).join(', '));
  const [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await beforeSubmit();
      const made = await preview.mutateAsync({
        preset_ids: [preset.id!],
        prompt: prompt.trim(),
        profile_id: profile || null,
      });
      onQueued(made.series.title);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      id="preset-preview-dialog"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('ws.presets.previewTitle')}
      description={t('ws.presets.previewDesc')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="preset-preview-form"
            className="btn primary"
            disabled={!prompt.trim() || busy}
          >
            <Icon name="plus" />
            {t('ws.presets.previewAdd')}
          </button>
        </>
      }
    >
      <form
        id="preset-preview-form"
        className="preset-preview-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="preset-preview-prompt">
            {t('ws.presets.previewPrompt')}
          </label>
          <textarea
            id="preset-preview-prompt"
            autoFocus
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="help">{t('ws.presets.previewPromptHelp')}</p>
        </div>
        <div className="field">
          <label className="label" htmlFor="preset-preview-profile">
            {t('ws.assemble.profile')}
          </label>
          <select
            id="preset-preview-profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            <option value="">{t('ws.assemble.profileDefault')}</option>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="help">{t('ws.assemble.profileHelp')}</p>
        </div>
      </form>
    </Modal>
  );
}

interface DropZone {
  'data-drop-group': string;
  isDropTarget: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/** A `<div>` that accepts dragged variable cards (the loose area). */
function DropArea({
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

function Group({
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

function EntryCard({
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
