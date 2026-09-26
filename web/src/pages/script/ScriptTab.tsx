import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  Copy,
  Download,
  ListChecks,
  Lock,
  MoveVertical,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api, data } from '../../api/client';
import { useRender } from '../../api/production';
import {
  useAddPanel,
  useBatchDeletePanels,
  useBatchPatchPanels,
  useDeletePanel,
  useDuplicatePanel,
  useImportPanels,
  usePatchEpisode,
  useReorderPanels,
} from '../../api/series';
import type { Panel, PromptPreview } from '../../api/types';
import { useSelection } from '../../app/selection';
import { useUI } from '../../app/ui-store';
import { confirm } from '../../components/confirm';
import { ContextMenu, useContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { Empty, Modal, NumberInput, TextArea } from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { AssistantDialog } from './AssistantDialog';
import { BatchEditDialog, type BatchBody } from './BatchEditDialog';
import { PanelEditor } from './PanelEditor';
import { PanelList } from './PanelList';
import { bundlePanels, downloadJson, PanelImportError, parsePanelBundle } from './panelIO';

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable=true]');

export default function ScriptTab() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const [params, setParams] = useSearchParams();
  const add = useAddPanel(episode.id!);
  const remove = useDeletePanel(episode.id!);
  const duplicate = useDuplicatePanel(episode.id!);
  const removeMany = useBatchDeletePanels(episode.id!);
  const patchMany = useBatchPatchPanels(episode.id!);
  const importPanels = useImportPanels(episode.id!);
  const reorder = useReorderPanels(episode.id!);
  const render = useRender(episode.id!);
  const patchEpisode = usePatchEpisode(episode.id!);
  const candidates = useUI((s) => s.candidates);
  const [assistant, setAssistant] = useState(false);
  const [synopsis, setSynopsis] = useState<string | null>(null);
  const [batch, setBatch] = useState<string[] | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ ids: string[]; to: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importAfter = useRef<string | null>(null);

  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const ids = useMemo(() => panels.map((p) => p.id!), [panels]);
  const selection = useSelection(ids);
  const covers = useMemo(
    () =>
      Object.fromEntries(
        episode.takes
          .filter((take) => take.status === 'adopted' && !take.variant_id)
          .map((take) => [take.panel_id, take.asset_id]),
      ),
    [episode.takes],
  );
  const selectedId = params.get('panel') ?? panels[0]?.id ?? null;
  const selected = panels.find((p) => p.id === selectedId) ?? null;
  const select = (id: string | null) => setParams(id ? { panel: id } : {}, { replace: true });
  const byId = (list: string[]) =>
    list.map((id) => panels.find((p) => p.id === id)!).filter(Boolean);
  const indexOf = (id: string) => ids.indexOf(id);
  const menu = useContextMenu<string[]>();

  const addAfter = () =>
    add.mutate(
      { panel: { description: '' }, after: selectedId },
      {
        onSuccess: (ep) => {
          const known = new Set(panels.map((p) => p.id));
          const created = ep.panels.find((p) => !known.has(p.id));
          if (created) select(created.id!);
        },
        onError: toastError,
      },
    );

  // Delete, land on the neighbour, and offer Undo (the panel's takes are kept server-side, so
  // re-adding it with the same id brings its images back).
  const deletePanel = (snapshot: Panel) => {
    const index = panels.findIndex((p) => p.id === snapshot.id);
    const before = panels[index - 1]?.id ?? null;
    const neighbour = panels[index + 1]?.id ?? before;
    remove.mutate(snapshot.id!, {
      onSuccess: () => {
        if (snapshot.id === selectedId) select(neighbour);
        toast(t('script.panelDeleted', { n: index + 1 }), {
          action: { label: t('common.undo'), onClick: () => restorePanel(snapshot, before) },
        });
      },
      onError: toastError,
    });
  };

  const restorePanel = async (snapshot: Panel, before: string | null) => {
    try {
      const ep = await add.mutateAsync({ panel: { ...snapshot }, after: before });
      if (before === null) {
        // `after: null` appends; move it back to the front.
        const rest = [...ep.panels].sort((a, b) => a.order - b.order).map((p) => p.id!);
        await reorder.mutateAsync([snapshot.id!, ...rest.filter((id) => id !== snapshot.id)]);
      }
      select(snapshot.id!);
    } catch (error) {
      toastError(error);
    }
  };

  const deleteMany = async (list: string[]) => {
    if (list.length === 1) {
      deletePanel(byId(list)[0]);
      return;
    }
    if (
      !(await confirm({
        title: t('batch.deleteTitle', { count: list.length }),
        description: t('batch.deleteHint'),
        confirmLabel: t('common.delete'),
        danger: true,
      }))
    )
      return;
    removeMany.mutate(list, {
      onSuccess: () => {
        if (selectedId && list.includes(selectedId))
          select(ids.find((id) => !list.includes(id)) ?? null);
        selection.clear();
        toast(t('batch.deleted', { count: list.length }));
      },
      onError: toastError,
    });
  };

  /** Move `list` (kept in order) so its first panel lands at 0-based `to`. */
  const moveTo = (list: string[], to: number) => {
    const moving = new Set(list);
    const rest = ids.filter((id) => !moving.has(id));
    const block = ids.filter((id) => moving.has(id));
    const at = Math.max(0, Math.min(to, rest.length));
    const next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
    if (next.join() !== ids.join()) reorder.mutate(next, { onError: toastError });
  };
  const nudge = (list: string[], delta: -1 | 1) => {
    const first = Math.min(...list.map(indexOf));
    const last = Math.max(...list.map(indexOf));
    if (delta < 0 && first === 0) return;
    if (delta > 0 && last === ids.length - 1) return;
    moveTo(list, delta < 0 ? first - 1 : first + 1);
  };

  const setLocked = (list: string[], locked: boolean) =>
    patchMany.mutate(
      { panelIds: list, changes: { locked } },
      {
        onSuccess: () =>
          toast(t(locked ? 'batch.locked' : 'batch.unlocked', { count: list.length })),
        onError: toastError,
      },
    );

  const renderMany = (list: string[]) =>
    render.mutate(
      { panel_ids: list, candidates: list.length === 1 ? 1 : candidates, variant_ids: [null] },
      { onSuccess: () => toast(t('script.queued', { count: list.length })), onError: toastError },
    );

  const copyPrompt = async (id: string) => {
    try {
      const p = data(
        await api.GET('/api/episodes/{episode_id}/panels/{panel_id}/prompt', {
          params: { path: { episode_id: episode.id!, panel_id: id } },
        }),
      ) as unknown as PromptPreview;
      await navigator.clipboard?.writeText(p.tags.positive);
      toast(t('common.copied'));
    } catch (error) {
      toastError(error);
    }
  };

  const exportMany = (list: string[]) => {
    const chosen = byId(list);
    downloadJson(`${episode.title || 'panels'}-${list.length}.json`, bundlePanels(chosen));
    navigator.clipboard
      ?.writeText(JSON.stringify(bundlePanels(chosen), null, 2))
      .catch(() => undefined);
    toast(t('batch.exported', { count: list.length }));
  };

  const onImportFile = async (file: File) => {
    try {
      const list = parsePanelBundle(await file.text());
      const after = importAfter.current ?? selectedId;
      importAfter.current = null;
      const ep = await importPanels.mutateAsync({ panels: list as never, after });
      const known = new Set(ids);
      const created = ep.panels.filter((p) => !known.has(p.id)).sort((a, b) => a.order - b.order);
      if (created[0]) select(created[0].id!);
      toast(t('batch.imported', { count: created.length }));
    } catch (error) {
      if (error instanceof PanelImportError)
        toastError(new Error(t(`batch.importError.${error.message}`)));
      else toastError(error);
    }
  };
  const pickImport = (after: string | null) => {
    importAfter.current = after;
    fileInput.current?.click();
  };

  const submitBatch = (body: BatchBody) => {
    if (!batch) return;
    patchMany.mutate(
      { panelIds: batch, changes: body.changes, appendText: body.append_text },
      {
        onSuccess: () => {
          setBatch(null);
          toast(t('batch.applied', { count: batch.length }));
        },
        onError: toastError,
      },
    );
  };

  // Keyboard on the list: Ctrl+A, Esc, Delete, ↑/↓ (Shift extends).  Text fields are left alone.
  const onListKey = (e: KeyboardEvent) => {
    if (isEditable(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selection.all();
    } else if (e.key === 'Escape') {
      selection.clear();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selection.ids.length) {
        e.preventDefault();
        void deleteMany(selection.ids);
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!selectedId) return;
      const next = ids[indexOf(selectedId) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      select(next);
      selection.click(next, { shiftKey: e.shiftKey });
    }
  };

  const onRowSelect = (
    id: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
  ) => {
    const extend = mods.ctrlKey || mods.metaKey || mods.shiftKey;
    // The open panel counts as the anchor when nothing is selected yet, so Ctrl / Shift-clicking
    // another row already gives a pair (legacy behaviour).  State updates are batched in order.
    if (extend && !selection.ids.length && selectedId && selectedId !== id)
      selection.only(selectedId);
    selection.click(id, mods);
    if (!extend) select(id);
  };
  const onRowMenu = (id: string, e: MouseEvent) => menu.open(e, selection.contextTarget(id));

  const menuGroups = (list: string[]): ContextGroup[] => {
    const n = list.length;
    const one = n === 1 ? byId(list)[0] : null;
    const allLocked = byId(list).every((p) => p.locked);
    return [
      {
        heading: n > 1 ? t('batch.selected', { count: n }) : undefined,
        items: one
          ? [
              {
                label: t('common.edit'),
                icon: <Pencil size={14} />,
                onSelect: () => select(one.id!),
              },
              {
                label: t('batch.edit'),
                icon: <ListChecks size={14} />,
                onSelect: () => setBatch(list),
              },
            ]
          : [
              {
                label: t('batch.edit'),
                icon: <ListChecks size={14} />,
                onSelect: () => setBatch(list),
              },
            ],
      },
      {
        items: [
          {
            label: t('batch.moveUp'),
            icon: <ArrowUp size={14} />,
            onSelect: () => nudge(list, -1),
            disabled: indexOf(list[0]) === 0,
          },
          {
            label: t('batch.moveDown'),
            icon: <ArrowDown size={14} />,
            onSelect: () => nudge(list, 1),
            disabled: indexOf(list[n - 1]) === ids.length - 1,
          },
          {
            label: t('batch.moveTo'),
            icon: <MoveVertical size={14} />,
            onSelect: () => setMoveTarget({ ids: list, to: indexOf(list[0]) + 1 }),
          },
          ...(one
            ? [
                {
                  label: t('script.duplicate'),
                  icon: <Copy size={14} />,
                  onSelect: () => duplicateOne(one.id!),
                },
              ]
            : []),
          {
            label: allLocked ? t('script.unlock') : t('script.lock'),
            icon: allLocked ? <Unlock size={14} /> : <Lock size={14} />,
            onSelect: () => setLocked(list, !allLocked),
          },
        ],
      },
      {
        items: [
          {
            label: n === 1 ? t('script.renderOne') : t('batch.render', { count: n }),
            icon: <Play size={14} />,
            onSelect: () => renderMany(list),
          },
          ...(one
            ? [
                {
                  label: t('script.copyPrompt'),
                  icon: <ClipboardCopy size={14} />,
                  onSelect: () => void copyPrompt(one.id!),
                },
              ]
            : []),
          {
            label: t('batch.export', { count: n }),
            icon: <Download size={14} />,
            onSelect: () => exportMany(list),
          },
          {
            label: t('batch.importAfter'),
            icon: <Upload size={14} />,
            onSelect: () => pickImport(list[n - 1]),
          },
        ],
      },
      {
        items: [
          {
            label: n === 1 ? t('script.deletePanel') : t('batch.delete', { count: n }),
            icon: <Trash2 size={14} />,
            danger: true,
            shortcut: 'Del',
            onSelect: () => void deleteMany(list),
          },
        ],
      },
    ];
  };

  const duplicateOne = (id: string) =>
    duplicate.mutate(id, {
      onSuccess: (ep) => {
        const known = new Set(ids);
        const created = ep.panels.find((p) => !known.has(p.id));
        if (created) select(created.id!);
      },
      onError: toastError,
    });

  const multi = selection.ids.length > 1 ? selection.ids : null;

  return (
    <div className="script-layout">
      <aside className="script-rail" onKeyDown={onListKey}>
        <div className="row" style={{ padding: '0 4px 10px' }}>
          <span className="small muted grow">{t('series.panels', { count: panels.length })}</span>
          <button className="btn sm" onClick={() => setAssistant(true)}>
            <Sparkles size={13} /> {t('script.assistant')}
          </button>
          <button
            className="btn icon sm"
            title={t('batch.import')}
            aria-label={t('batch.import')}
            onClick={() => pickImport(selectedId)}
          >
            <Upload size={14} />
          </button>
          <button className="btn icon sm" title={t('script.addPanel')} onClick={addAfter}>
            <Plus size={14} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onImportFile(file);
            }}
          />
        </div>
        <details className="synopsis">
          <summary className="small muted">{t('episode.synopsis')}</summary>
          <TextArea rows={3} value={synopsis ?? episode.synopsis ?? ''} onChange={setSynopsis} />
          {synopsis !== null && synopsis !== episode.synopsis ? (
            <button
              className="btn sm"
              onClick={() =>
                patchEpisode.mutate(
                  { synopsis },
                  { onSuccess: () => setSynopsis(null), onError: toastError },
                )
              }
            >
              {t('common.save')}
            </button>
          ) : null}
        </details>
        {multi ? (
          <div className="selection-bar" role="status">
            <span className="count">{t('batch.selected', { count: multi.length })}</span>
            <span className="grow" />
            <button className="btn ghost sm" onClick={() => setBatch(multi)}>
              <ListChecks size={13} /> {t('batch.edit')}
            </button>
            <button className="btn ghost sm" onClick={() => renderMany(multi)}>
              <Play size={13} /> {t('board.render')}
            </button>
            <button className="btn ghost sm" onClick={() => exportMany(multi)}>
              <Download size={13} /> {t('common.export')}
            </button>
            <button className="btn ghost sm danger" onClick={() => void deleteMany(multi)}>
              <Trash2 size={13} /> {t('common.delete')}
            </button>
            <button className="btn ghost sm" onClick={selection.clear} title="Esc">
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
        <PanelList
          panels={panels}
          series={series}
          selected={selectedId}
          checked={selection.set}
          covers={covers}
          onSelect={onRowSelect}
          onContextMenu={onRowMenu}
          onReorder={(order) => reorder.mutate(order, { onError: toastError })}
        />
        <p className="small muted" style={{ padding: '10px 4px 0' }}>
          {t('batch.listHint')}
        </p>
      </aside>
      <section className="script-main">
        {selected ? (
          <PanelEditor
            key={selected.id}
            episode={episode}
            series={series}
            panel={selected}
            index={panels.indexOf(selected)}
            onDelete={deletePanel}
          />
        ) : (
          <Empty
            action={
              <button className="btn primary" onClick={addAfter}>
                <Plus size={15} /> {t('script.addPanel')}
              </button>
            }
          >
            {t('script.selectPanel')}
          </Empty>
        )}
      </section>
      <AssistantDialog episodeId={episode.id!} open={assistant} onOpenChange={setAssistant} />
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          groups={menuGroups(menu.state.payload)}
          onClose={menu.close}
        />
      ) : null}
      {batch ? (
        <BatchEditDialog
          open
          onOpenChange={(open) => !open && setBatch(null)}
          count={batch.length}
          series={series}
          panels={byId(batch)}
          busy={patchMany.isPending}
          onSubmit={submitBatch}
        />
      ) : null}
      <Modal
        open={!!moveTarget}
        onOpenChange={(open) => !open && setMoveTarget(null)}
        title={t('batch.moveTo')}
        description={t('batch.moveHint', { count: moveTarget?.ids.length ?? 0, max: ids.length })}
        footer={
          <>
            <button className="btn ghost" onClick={() => setMoveTarget(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (moveTarget) moveTo(moveTarget.ids, moveTarget.to - 1);
                setMoveTarget(null);
              }}
            >
              {t('common.ok')}
            </button>
          </>
        }
      >
        <NumberInput
          min={1}
          max={ids.length}
          step={1}
          value={moveTarget?.to ?? 1}
          onChange={(to) => setMoveTarget((m) => (m ? { ...m, to: to ?? 1 } : m))}
        />
      </Modal>
    </div>
  );
}
