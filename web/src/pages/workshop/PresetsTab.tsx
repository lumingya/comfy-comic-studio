import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSeriesList, useTrashSeries } from '../../api/series';
import { PREVIEW_SUBTITLE, localId } from '../../api/workshop';
import type { Series } from '../../api/types';
import { QueryError } from '../../app/errors';
import { Icon } from '../../app/icons';
import { AutoSaveGuard } from '../../app/useAutoDraft';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { Loading } from '../../components/ui';
import { ContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { askAssetTitle } from './storyActions';
import { downloadJson, presetToFile } from './files';
import { BindingDialog, BindingsSection } from './PresetBindings';
import { PresetHeader, PresetLibraryActions } from './PresetLibrary';
import { PreviewDialog, PreviewFigure } from './PresetPreviews';
import { PresetVariableEditor } from './PresetVariableEditor';
import { usePresetLibrary } from './presetsState';
import { WorkshopFrame } from './WorkshopPage';
import { useWorkshopSource, workshopHref } from './workshopSource';

/** Right-clicks on these keep the browser menu (legacy workshopContextSpec). */
const NATIVE_MENU =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),a[href],dialog,[role=dialog],.context-menu';

/** 预设工坊: named sets of `{变量}` values, grouped, saved automatically. */
export default function PresetsTab() {
  const ws = useWorkshopSource();
  if (ws.error)
    return (
      <WorkshopFrame tab="presets">
        <QueryError error={ws.error} onRetry={ws.refetch} />
      </WorkshopFrame>
    );
  if (!ws.data) return <Loading />;
  return <PresetsEditor key={ws.data.id} workshop={ws.data} />;
}
function PresetsEditor({ workshop }: { workshop: Series }) {
  const { t } = useTranslation();
  const library = usePresetLibrary(workshop);
  const { draft, kitId, presets, current, update, addPreset, importPresets, addEntry } = library;
  const [editGroups, setEditGroups] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bindingEdit, setBindingEdit] = useState<number | 'new' | null>(null);
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
  const shelf = useSeriesList();
  const trashSeries = useTrashSeries();
  const navigate = useNavigate();
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
  const actions = (
    <PresetLibraryActions
      library={library}
      exporting={exporting}
      onExportingChange={setExporting}
    />
  );
  if (!current)
    return (
      <WorkshopFrame tab="presets" actions={actions}>
        <AutoSaveGuard save={draft} includeSearch />
        <div className="eco-empty">
          <h3>{t('ws.presets.emptyTitle')}</h3>
          <p>{t('ws.presets.emptyBody')}</p>
        </div>
      </WorkshopFrame>
    );

  return (
    <WorkshopFrame tab="presets" actions={actions}>
      <AutoSaveGuard save={draft} includeSearch />
      <PresetHeader library={library} headRef={headRef} onPreview={() => setPreviewing(true)} />
      {previews.length ? (
        <div className="workshop-preset-preview" role="list" aria-label={t('ws.presets.previews')}>
          {previews.map((album) => (
            <PreviewFigure
              key={album.id}
              album={album}
              onOpen={() => navigate(workshopHref('/workshop/assembly', kitId))}
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
          kitId={kitId}
          sourceDefaults={workshop.generation_defaults}
          preset={current}
          onClose={() => setPreviewing(false)}
          beforeSubmit={() => draft.flushAll()}
          onQueued={(title) => {
            setPreviewing(false);
            toast(t('ws.presets.previewQueued', { title }));
            navigate(workshopHref('/workshop/assembly', kitId));
          }}
        />
      ) : null}
      <PresetVariableEditor
        current={current}
        update={update}
        addEntry={addEntry}
        editGroups={editGroups}
        setEditGroups={setEditGroups}
      />
      <BindingsSection
        key={current.id}
        preset={current}
        presets={presets}
        onEdit={setBindingEdit}
        onToggle={(index, enabled) =>
          update(
            (p) => ({
              ...p,
              bindings: p.bindings.map((b, i) => (i === index ? { ...b, enabled } : b)),
            }),
            true,
          )
        }
        onRemove={async (index) => {
          const b = current.bindings[index];
          if (
            !(await confirm({
              title: t('ws.presets.binding.removeConfirm', { target: `${b.node_id} · ${b.path}` }),
              confirmLabel: t('common.delete'),
              danger: true,
            }))
          )
            return;
          update((p) => ({ ...p, bindings: p.bindings.filter((_, i) => i !== index) }), true);
        }}
      />
      {bindingEdit !== null ? (
        <BindingDialog
          preset={current}
          index={bindingEdit}
          onClose={() => setBindingEdit(null)}
          onSave={(bindings) => {
            update((p) => ({ ...p, bindings }), true);
            setBindingEdit(null);
          }}
        />
      ) : null}
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
            onSelect: () => setPreviewing(true),
          },
          {
            label: t('ws.presets.menu.newTaskDots'),
            icon: <Icon name="play" sm />,
            onSelect: () => navigate(workshopHref('/workshop/assembly', kitId, { new: '1' })),
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
            label: t('ws.presets.menu.bindingDots'),
            icon: <Icon name="nodes" sm />,
            hint: t('ws.presets.menu.bindingHint'),
            onSelect: () => setBindingEdit('new'),
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
          {
            label: t('ws.presets.menu.exportPickDots'),
            icon: <Icon name="upload" sm />,
            onSelect: () => setExporting(true),
          },
        ],
      },
      {
        heading: t('ws.menu.switchTo'),
        items: [
          {
            label: t('ws.tab.story'),
            icon: <Icon name="story" sm />,
            onSelect: () => navigate(workshopHref('/workshop/story', kitId)),
          },
          {
            label: t('ws.tab.assembly'),
            icon: <Icon name="play" sm />,
            onSelect: () => navigate(workshopHref('/workshop/assembly', kitId)),
          },
        ],
      },
    ];
  }
}
