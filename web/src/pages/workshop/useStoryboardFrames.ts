import { arrayMove } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keys } from '../../api/keys';
import {
  useAddPanel,
  useBatchDeletePanels,
  useBatchPatchPanels,
  useDuplicatePanel,
  useImportPanels,
  usePatchEpisode,
  usePatchPanel,
  useReorderPanels,
} from '../../api/series';
import type { Episode, Panel, PanelOverrides } from '../../api/types';
import { useSelection } from '../../app/selection';
import { flushDraft, type AutosaveController } from '../../app/useAutoDraft';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import type { BatchFramesResult } from './BatchFramesDialog';
import { MAX_FRAMES, restoredOrder } from './frameBatch';
import { promptOf } from './storyboardPrompts';

export function useStoryboardFrames(episode: Episode) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const patchBoard = usePatchEpisode(episode.id!);
  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const [activeId, setActiveId] = useState<string | undefined>(panels[0]?.id);
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  const add = useAddPanel(episode.id!);
  const editorSave = useRef<AutosaveController | null>(null);
  const registerSave = useCallback((save: AutosaveController | null) => {
    editorSave.current = save;
  }, []);
  const choose = async (id: string | undefined) => {
    try {
      if (editorSave.current) await flushDraft(editorSave.current);
      setActiveId(id);
    } catch (error) {
      toastError(error);
    }
  };
  const panelIds = useMemo(() => panels.map((p) => p.id!), [panels]);
  const selection = useSelection(panelIds);
  const duplicate = useDuplicatePanel(episode.id!);
  const removeMany = useBatchDeletePanels(episode.id!);
  const reorder = useReorderPanels(episode.id!);
  const patchOne = usePatchPanel(episode.id!);
  const patchMany = useBatchPatchPanels(episode.id!);
  const flush = async () => {
    if (editorSave.current) await flushDraft(editorSave.current);
  };
  const basePrompt = () => episode.base_prompt ?? '';
  const restore = useImportPanels(episode.id!);
  /** Legacy workshop-frame-delete-bulk: at least one frame stays, and the deletion can be undone. */
  const removeSelected = async (ids: string[]) => {
    if (!ids.length || removeMany.isPending) return;
    if (ids.length >= panels.length) {
      toastError(new Error(t('ws.story.menu.keepOne')));
      return;
    }
    if (
      !(await confirm({
        title: t('batch.deleteTitle', { count: ids.length }),
        description: t('ws.story.deleteUndoable'),
        danger: true,
      }))
    )
      return;
    try {
      const openDraft = editorSave.current;
      await flush();
      const latest = qc.getQueryData<Episode>(keys.episode(episode.id)) ?? episode;
      const savedPanels = [...latest.panels].sort((a, b) => a.order - b.order);
      const original = savedPanels.map((p) => p.id!);
      const gone = savedPanels.filter((p) => ids.includes(p.id!));
      await removeMany.mutateAsync(ids);
      if (active?.id && ids.includes(active.id)) openDraft?.discard();
      selection.clear();
      toast(t('ws.story.deleted', { count: gone.length }), {
        duration: 10_000,
        action: {
          label: t('common.undo'),
          onClick: () =>
            void (async () => {
              const ep = (await restore.mutateAsync({
                panels: gone as unknown as Record<string, unknown>[],
                after: null,
              })) as unknown as { panels: Panel[] };
              const current = [...ep.panels].sort((a, b) => a.order - b.order).map((p) => p.id!);
              const fresh = current.slice(-gone.length);
              await reorder.mutateAsync(
                restoredOrder(
                  original,
                  gone.map((p) => p.id!),
                  fresh,
                  current,
                ),
              );
            })().catch(toastError),
        },
      });
    } catch (error) {
      toastError(error);
    }
  };
  const copySelected = async (ids: string[]) => {
    try {
      await flush();
      for (const id of ids) await duplicate.mutateAsync(id);
    } catch (error) {
      toastError(error);
    }
  };
  const reorderLock = useRef(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const reordering = reorderBusy || reorder.isPending;
  const changeOrder = async (id: string, target: (ids: string[], from: number) => number) => {
    if (reorderLock.current || reorder.isPending) return;
    reorderLock.current = true;
    setReorderBusy(true);
    try {
      await flush();
      const latest = qc.getQueryData<Episode>(keys.episode(episode.id)) ?? episode;
      const ids = [...latest.panels].sort((a, b) => a.order - b.order).map((p) => p.id!);
      const from = ids.indexOf(id);
      const to = target(ids, from);
      if (from < 0 || to < 0 || to >= ids.length || to === from) return;
      await reorder.mutateAsync(arrayMove(ids, from, to));
    } catch (error) {
      toastError(error);
    } finally {
      reorderLock.current = false;
      setReorderBusy(false);
    }
  };
  const moveFrame = (id: string, dir: -1 | 1) => changeOrder(id, (_ids, from) => from + dir);
  const dropFrame = (id: string, over: string) =>
    changeOrder(id, (ids) => {
      if (ids.length !== panelIds.length || ids.some((frameId, i) => frameId !== panelIds[i]))
        throw new Error(t('ws.story.dragOrderChanged'));
      return ids.indexOf(over);
    });
  /** Legacy 插入起手模板: fill the empty prompts among `ids` with the story's starting template. */
  const applyBase = async (ids: string[]) => {
    try {
      await flush();
      const latest = qc.getQueryData<Episode>(keys.episode(episode.id)) ?? episode;
      const base = latest.base_prompt ?? '';
      const blank = latest.panels
        .filter((p) => ids.includes(p.id!) && !promptOf(p).trim())
        .map((p) => p.id!);
      if (!base || !blank.length) return;
      if (blank.length === 1)
        await patchOne.mutateAsync({
          panelId: blank[0],
          changes: { overrides: { raw_prompt: base } },
        });
      else
        await patchMany.mutateAsync({
          panelIds: blank,
          changes: { overrides: { raw_prompt: base } },
        });
    } catch (error) {
      toastError(error);
    }
  };
  const [batch, setBatch] = useState(false);
  const [transfer, setTransfer] = useState<{ episode: Episode; ids: string[] } | null>(null);
  const openTransfer = async (ids: string[]) => {
    try {
      await flush();
      setTransfer({ episode: qc.getQueryData<Episode>(keys.episode(episode.id)) ?? episode, ids });
    } catch (error) {
      toastError(error);
    }
  };
  const importPanels = useImportPanels(episode.id!);

  /** Legacy workshop-add-frame: a blank 「第 N 幕」 at the end (or right after `anchor`), opened. */
  const addFrame = (anchor: string | null = null) => {
    const run = async () => {
      if (panels.length >= MAX_FRAMES) throw new Error(t('ws.story.batch.full'));
      await flush();
      const ep = await add.mutateAsync({
        panel: {
          description: t('ws.story.frameN', { n: panels.length + 1 }),
          overrides: { raw_prompt: '' } as PanelOverrides,
        },
        after: anchor,
      });
      const sorted = [...ep.panels].sort((a, b) => a.order - b.order);
      const idx = anchor ? sorted.findIndex((p) => p.id === anchor) + 1 : sorted.length - 1;
      setActiveId(sorted[idx]?.id);
      selection.clear();
    };
    run().catch(toastError);
  };
  const openBatch = () => {
    if (panels.length >= MAX_FRAMES) toastError(new Error(t('ws.story.batch.full')));
    else setBatch(true);
  };
  /** Legacy workshop-add-frames-confirm: append the batch, optionally remember the template. */
  const addBatch = async ({ frames, remember }: BatchFramesResult) => {
    try {
      await flush();
      const ep = await importPanels.mutateAsync({ panels: frames, after: null });
      if (remember !== null && remember !== (ep.base_prompt ?? ''))
        await patchBoard.mutateAsync({ base_prompt: remember });
      const sorted = [...ep.panels].sort((a, b) => a.order - b.order);
      setActiveId(sorted[sorted.length - frames.length]?.id);
      selection.clear();
      setBatch(false);
      toast(t('ws.story.batch.done', { n: frames.length }));
    } catch (error) {
      toastError(error);
    }
  };

  return {
    active,
    panels,
    panelIds,
    basePrompt,
    selection,
    registerSave,
    choose,
    removeSelected,
    copySelected,
    moveFrame,
    applyBase,
    transfer,
    setTransfer,
    openTransfer,
    addFrame,
    batch,
    setBatch,
    openBatch,
    addBatch,
    adding: add.isPending,
    importing: importPanels.isPending,
    remembering: patchBoard.isPending,
    duplicating: duplicate.isPending,
    removing: removeMany.isPending,
    reordering,
    dropFrame,
  };
}
