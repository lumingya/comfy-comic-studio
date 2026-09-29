import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import { useSelection } from '../../app/selection';
import {
  ContextMenu,
  useContextMenu,
  type ContextGroup,
  type ContextItem,
} from '../../components/ContextMenu';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { keys } from '../../api/keys';
import {
  useAddPanel,
  useBatchDeletePanels,
  useBatchPatchPanels,
  useCreateEpisode,
  useDeletePanel,
  useDuplicatePanel,
  useImportPanels,
  usePatchEpisode,
  usePatchPanel,
  useReorderPanels,
} from '../../api/series';
import type { Panel, PanelOverrides } from '../../api/types';
import { useWorkshop } from '../../api/workshop';
import { Icon } from '../../app/icons';
import {
  AutoSaveGuard,
  flushDraft,
  useAutoDraft,
  type AutosaveController,
} from '../../app/useAutoDraft';
import { shortcutBlocked } from '../../app/shortcuts';
import { SaveState } from '../../components/SaveState';
import { captionText, replaceCaption } from './caption';
import { BatchFramesDialog, type BatchFramesResult } from './BatchFramesDialog';
import { MAX_FRAMES } from './frameBatch';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import {
  askAssetTitle,
  createStoryboard,
  exportStoryboard,
  importStoryboards,
} from './storyActions';
import { useEpisodeContext } from '../episode/EpisodePage';
import {
  PromptSurface,
  variableUsage,
  type KnownVariables,
  type PromptSources,
  type PromptUsage,
} from './PromptSurface';

/** Every variable some preset defines (true when at least one gives it a value). */
export function useKnownVariables(): KnownVariables {
  const ws = useWorkshop();
  return useMemo(() => {
    const known: KnownVariables = new Map();
    for (const p of ws.data?.presets ?? [])
      for (const e of p.entries) known.set(e.key, known.get(e.key) || !!e.value.trim());
    for (const [k, v] of Object.entries(ws.data?.variables ?? {}))
      known.set(k, known.get(k) || !!v.trim());
    return known;
  }, [ws.data]);
}

/** Variable name → the presets defining it (title + value), in library order, for completion. */
export function usePromptSources(): PromptSources {
  const ws = useWorkshop();
  return useMemo(() => {
    const sources: PromptSources = new Map();
    for (const p of ws.data?.presets ?? [])
      for (const e of p.entries) {
        const list = sources.get(e.key) ?? [];
        list.push({ title: p.title, value: e.value });
        sources.set(e.key, list);
      }
    return sources;
  }, [ws.data]);
}

const HINT_KEY = 'cc-hint-multiselect';
const promptOf = (p: Panel) => p.overrides.raw_prompt ?? '';
/** Legacy 只选空白分幕: neither a prompt nor dialogue. */
const isEmptyFrame = (p: Panel) => !promptOf(p).trim() && !captionText(p.dialogues).trim();

/** 分镜工坊: legacy frame list + page editor (name, prompt, negative, caption, parameters). */
/** Right-clicks on these keep the browser menu (legacy workshopContextSpec). */
const NATIVE_MENU =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),a[href],dialog,[role=dialog],.context-menu';

export default function StoryboardEditor() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createBoard = useCreateEpisode(series.id!);
  const patchBoard = usePatchEpisode(episode.id!);
  const known = useKnownVariables();
  const sources = usePromptSources();
  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const used = useMemo(
    () => variableUsage(panels.flatMap((p) => [promptOf(p), p.overrides.raw_negative ?? ''])),
    [panels],
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
  const menu = useContextMenu<DesktopContext>();
  const duplicate = useDuplicatePanel(episode.id!);
  const removeMany = useBatchDeletePanels(episode.id!);
  const reorder = useReorderPanels(episode.id!);
  const patchOne = usePatchPanel(episode.id!);
  const patchMany = useBatchPatchPanels(episode.id!);
  const flush = async () => {
    if (editorSave.current) await flushDraft(editorSave.current);
  };
  const basePrompt = () => episode.base_prompt ?? '';
  const removeSelected = async (ids: string[]) => {
    if (
      !ids.length ||
      removeMany.isPending ||
      ids.length >= panels.length ||
      !(await confirm({ title: t('batch.deleteTitle', { count: ids.length }), danger: true }))
    )
      return;
    try {
      if (editorSave.current) await flushDraft(editorSave.current).catch(() => undefined);
      await removeMany.mutateAsync(ids);
      if (active?.id && ids.includes(active.id)) editorSave.current?.discard();
      selection.clear();
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
  const moveFrame = async (id: string, dir: -1 | 1) => {
    const ids = [...panelIds];
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await flush();
      await reorder.mutateAsync(ids);
    } catch (error) {
      toastError(error);
    }
  };
  /** Legacy 插入起手模板: fill the empty prompts among `ids` with the story's starting template. */
  const applyBase = async (ids: string[]) => {
    const base = basePrompt();
    const blank = panels
      .filter((p) => ids.includes(p.id!) && !promptOf(p).trim())
      .map((p) => p.id!);
    if (!base || !blank.length) return;
    try {
      await flush();
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
  const [hintSeen, setHintSeen] = useState(() => localStorage.getItem(HINT_KEY) === 'seen');
  const seeHint = () => {
    localStorage.setItem(HINT_KEY, 'seen');
    setHintSeen(true);
  };
  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: true,
    pinned: false,
    contextOpen: !!menu.state,
    onExit: selection.clear,
    onOpen: (id) => {
      void choose(id);
    },
    onDelete: (ids) => {
      void removeSelected(ids);
    },
    onContext: menu.openAt,
    onCloseContext: menu.close,
  });
  useEffect(() => {
    if (active?.id && !selection.ids.length) selection.anchorAt(active.id);
  }, [active?.id, selection.ids.length, selection.anchorAt]);
  const activeIndex = active ? panels.indexOf(active) : -1;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
      if (document.querySelector('dialog[open]') || activeIndex < 0) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = panels[activeIndex + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) void choose(next.id);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const next = panels[activeIndex + 1];
        void (async () => {
          await choose(next?.id ?? active?.id);
          if (next) document.getElementById('workshop-frame-prompt')?.focus();
        })();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const [batch, setBatch] = useState(false);
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

  // Legacy workshopStoryContextItems: right-clicking anywhere else on the 分镜工坊 page (the
  // heading, the 当前分镜 row, the space around the editor) opens the storyboard menu; the frame
  // editor opens the menu of the frame being edited.  Bound natively on the page so the frames
  // list (which owns its own menu) is not affected.
  const editorRef = useRef<HTMLDivElement>(null);
  const [storyMenu, setStoryMenu] = useState<{ x: number; y: number; target: HTMLElement } | null>(
    null,
  );
  const activeId2 = active?.id;
  const openFrameMenu = menu.openAt;
  useEffect(() => {
    const host = editorRef.current?.closest<HTMLElement>('.assembly-workshop');
    if (!host) return;
    const onMenu = (e: globalThis.MouseEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(NATIVE_MENU) || target.closest('.workshop-frames-list')) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      if (target.closest('.workshop-page') && activeId2) {
        setStoryMenu(null);
        openFrameMenu(e.clientX, e.clientY, { ids: [activeId2], focusId: activeId2, target });
        return;
      }
      setStoryMenu({ x: e.clientX, y: e.clientY, target });
    };
    host.addEventListener('contextmenu', onMenu);
    return () => host.removeEventListener('contextmenu', onMenu);
  }, [activeId2, openFrameMenu]);
  useEffect(() => {
    if (menu.state) setStoryMenu(null);
  }, [menu.state]);
  const storyMenuGroups = (): ContextGroup[] => {
    const go = (fn: () => Promise<unknown>) => () => void fn().catch(toastError);
    return [
      {
        heading: `${episode.title} · ${t('ws.story.frames', { count: panels.length })}`,
        items: [
          {
            label: t('ws.story.addFrame'),
            icon: <Icon name="plus" sm />,
            primary: true,
            disabled: add.isPending || panels.length >= MAX_FRAMES,
            onSelect: () => addFrame(),
          },
          {
            label: t('ws.story.menu.addFramesDots'),
            icon: <Icon name="list" sm />,
            hint: t('ws.story.menu.addFramesHint'),
            disabled: importPanels.isPending || panels.length >= MAX_FRAMES,
            onSelect: openBatch,
          },
          {
            label: t('ws.story.menu.selectAll'),
            icon: <Icon name="check" sm />,
            shortcut: 'Ctrl/⌘ A',
            hint: t('ws.story.menu.selectAllHint'),
            disabled: panels.length < 1,
            onSelect: selection.all,
          },
        ],
      },
      {
        items: [
          {
            label: t('ws.story.toAssembly'),
            icon: <Icon name="arrow" sm />,
            hint: t('ws.story.menu.toAssemblyHint'),
            onSelect: () => navigate(`/workshop/assembly?story=${episode.id}`),
          },
        ],
      },
      {
        heading: t('ws.story.menu.storyGroup'),
        items: [
          {
            label: t('ws.story.menu.renameDots'),
            icon: <Icon name="edit" sm />,
            onSelect: go(async () => {
              const title = await askAssetTitle(episode.title, t);
              if (title) await patchBoard.mutateAsync({ title });
            }),
          },
          {
            label: t('ws.story.menu.newDots'),
            icon: <Icon name="plus" sm />,
            onSelect: go(async () => {
              const e = await createStoryboard(createBoard, t);
              if (!e) return;
              await qc.invalidateQueries({ queryKey: keys.episodesOf(series.id!) });
              navigate(`/workshop/story/${e.id}`);
            }),
          },
          {
            label: t('ws.story.menu.exportThis'),
            icon: <Icon name="upload" sm />,
            onSelect: go(() => exportStoryboard(qc, episode)),
          },
        ],
      },
      {
        heading: t('ws.story.menu.libraryGroup'),
        items: [
          {
            label: t('ws.story.menu.importDots'),
            icon: <Icon name="download" sm />,
            hint: t('ws.story.menu.importHint'),
            onSelect: go(async () => {
              const { last, count } = await importStoryboards(createBoard);
              if (!last) return;
              await qc.invalidateQueries({ queryKey: keys.episodesOf(series.id!) });
              navigate(`/workshop/story/${last}`);
              toast(t('ws.imported', { count }));
            }),
          },
        ],
      },
      {
        heading: t('ws.menu.switchTo'),
        items: [
          {
            label: t('ws.tab.presets'),
            icon: <Icon name="brush" sm />,
            onSelect: () => navigate('/workshop/presets'),
          },
          {
            label: t('ws.tab.assembly'),
            icon: <Icon name="play" sm />,
            onSelect: () => navigate('/workshop/assembly'),
          },
        ],
      },
    ];
  };

  /** Legacy workshopFrameContextItems / workshopFramesSelectionContextItems. */
  const frameMenu = ({ ids, focusId }: DesktopContext): ContextGroup[] => {
    const focus = panels.find((p) => p.id === focusId) ?? panels.find((p) => p.id === ids[0]);
    const base = basePrompt();
    const pickEmpty = () => selection.replace(panels.filter(isEmptyFrame).map((p) => p.id!));
    const select: ContextGroup = {
      heading: t('ws.story.menu.select'),
      items: [
        { label: t('ws.story.menu.selectAll'), shortcut: 'Ctrl/⌘ A', onSelect: selection.all },
        {
          label: t('ws.story.menu.selectEmpty'),
          hint: t('ws.story.menu.selectEmptyHint'),
          onSelect: pickEmpty,
        },
      ],
      note: t('ws.story.menu.selectHint'),
    };
    if (!focus) return [select];
    const index = panels.indexOf(focus);
    const editItem = (hint?: string): ContextItem => ({
      label: focus.id === active?.id ? t('ws.story.menu.editing') : t('ws.story.menu.edit'),
      icon: <Icon name="edit" sm />,
      primary: true,
      disabled: focus.id === active?.id,
      shortcut: hint ? undefined : t('ws.story.menu.editShortcut'),
      hint,
      onSelect: () => void choose(focus.id),
    });
    if (ids.length > 1 && ids.includes(focus.id!)) {
      const blank = panels.filter((p) => ids.includes(p.id!) && !promptOf(p).trim()).length;
      return [
        {
          heading: t('ws.story.menu.selected', { count: ids.length }),
          items: [
            editItem(focus.description || undefined),
            {
              label: blank
                ? t('ws.story.menu.applyBaseMany', { count: blank })
                : t('ws.story.applyBase'),
              icon: <Icon name="spark" sm />,
              disabled: !base || !blank,
              hint: !base
                ? t('ws.story.menu.baseMissing')
                : blank
                  ? undefined
                  : t('ws.story.menu.applyBaseNone'),
              onSelect: () => void applyBase(ids),
            },
            {
              label: t('ws.story.menu.copyMany'),
              icon: <Icon name="copy" sm />,
              hint: t('ws.story.menu.copyManyHint'),
              disabled: duplicate.isPending,
              onSelect: () => void copySelected(ids),
            },
          ],
        },
        {
          items: [
            { label: t('ws.story.menu.selectAll'), shortcut: 'Ctrl/⌘ A', onSelect: selection.all },
            { label: t('ws.story.menu.selectEmpty'), onSelect: pickEmpty },
            { label: t('ws.story.menu.clear'), shortcut: 'Esc', onSelect: selection.clear },
          ],
        },
        {
          items: [
            {
              label: t('ws.story.menu.removeMany', { count: ids.length }),
              icon: <Icon name="trash" sm />,
              danger: true,
              shortcut: 'Delete',
              disabled: removeMany.isPending || ids.length >= panels.length,
              title: ids.length >= panels.length ? t('ws.story.menu.keepOne') : undefined,
              onSelect: () => void removeSelected(ids),
            },
          ],
        },
      ];
    }
    const taken = !!promptOf(focus).trim();
    return [
      {
        items: [
          editItem(),
          {
            label: t('ws.story.applyBase'),
            icon: <Icon name="spark" sm />,
            disabled: !base || taken,
            hint: !base
              ? t('ws.story.menu.baseMissing')
              : taken
                ? t('ws.story.menu.baseTaken')
                : t('ws.story.menu.baseFill'),
            onSelect: () => void applyBase([focus.id!]),
          },
        ],
      },
      {
        items: [
          {
            label: t('ws.story.menu.insertAfter'),
            icon: <Icon name="plus" sm />,
            disabled: add.isPending,
            onSelect: () => addFrame(focus.id!),
          },
          {
            label: t('ws.story.menu.copyOne'),
            icon: <Icon name="copy" sm />,
            hint: t('ws.story.menu.copyHint'),
            disabled: duplicate.isPending,
            onSelect: () => void copySelected([focus.id!]),
          },
          {
            label: t('ws.story.menu.moveUp'),
            icon: <Icon name="up" sm />,
            disabled: index === 0 || reorder.isPending,
            onSelect: () => void moveFrame(focus.id!, -1),
          },
          {
            label: t('ws.story.menu.moveDown'),
            icon: <Icon name="down" sm />,
            disabled: index >= panels.length - 1 || reorder.isPending,
            onSelect: () => void moveFrame(focus.id!, 1),
          },
        ],
      },
      select,
      {
        items: [
          {
            label: t('ws.story.menu.remove'),
            icon: <Icon name="trash" sm />,
            danger: true,
            disabled: removeMany.isPending || panels.length <= 1,
            title: panels.length <= 1 ? t('ws.story.menu.keepOne') : undefined,
            onSelect: () => void removeSelected([focus.id!]),
          },
        ],
      },
    ];
  };

  return (
    <>
      <div className="workshop-editor" ref={editorRef}>
        <nav className="workshop-frames" aria-label={t('ws.story.framesLabel')}>
          <div
            className="workshop-frames-list desktop-list"
            ref={desktop.ref}
            tabIndex={0}
            onClickCapture={desktop.onClickCapture}
            onContextMenu={desktop.onContextMenu}
            onPointerDown={desktop.onPointerDown}
            onDragStartCapture={desktop.onDragStartCapture}
          >
            {(desktop.snapshot ?? selection.ids).length ? (
              <div className="selection-bar" role="status">
                <span>
                  {t('interaction.selected', { count: (desktop.snapshot ?? selection.ids).length })}
                </span>
                <button type="button" className="btn ghost small" onClick={selection.clear}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : null}
            {panels.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`${p.id === active?.id ? 'active' : ''} ${selection.has(p.id!) ? 'checked' : ''} ${menu.state?.payload.focusId === p.id ? 'is-context' : ''}`}
                data-selection-id={p.id}
                data-selection-open
                aria-selected={selection.has(p.id!) || undefined}
                aria-current={p.id === active?.id ? 'true' : undefined}
              >
                <small>{String(i + 1).padStart(2, '0')}</small>
                <span>{p.description || t('ws.story.frameN', { n: i + 1 })}</span>
              </button>
            ))}
          </div>
          {panels.length > 1 && !hintSeen && !selection.ids.length ? (
            <p className="multiselect-hint">
              <span>{t('classic.shelf.multiHint')}</span>
              <button type="button" className="link-button" onClick={seeHint}>
                {t('classic.shelf.multiHintOk')}
              </button>
            </p>
          ) : null}
          <div className="workshop-frames-actions">
            <button
              type="button"
              className="btn small"
              disabled={add.isPending || panels.length >= MAX_FRAMES}
              onClick={() => addFrame()}
            >
              <Icon name="plus" sm />
              {t('ws.story.addFrame')}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={importPanels.isPending || panels.length >= MAX_FRAMES}
              aria-haspopup="dialog"
              onClick={openBatch}
            >
              <Icon name="list" sm />
              {t('ws.story.addFrames')}
            </button>
          </div>
        </nav>
        {active ? (
          <FramePage
            key={active.id}
            panel={active}
            index={panels.indexOf(active)}
            count={panels.length}
            panels={panels}
            known={known}
            sources={sources}
            used={used}
            base={basePrompt()}
            onSelect={(id) => void choose(id)}
            registerSave={registerSave}
          />
        ) : (
          <section className="workshop-page is-empty">
            <p className="help">{t('ws.story.noFrames')}</p>
          </section>
        )}
      </div>
      {batch ? (
        <BatchFramesDialog
          existing={panels.length}
          prompts={panels.map(promptOf)}
          remembered={basePrompt()}
          known={known}
          sources={sources}
          busy={importPanels.isPending || patchBoard.isPending}
          onClose={() => setBatch(false)}
          onSubmit={(result) => void addBatch(result)}
        />
      ) : null}
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          returnFocus={menu.state.payload.target}
          onClose={menu.close}
          groups={frameMenu(menu.state.payload)}
        />
      ) : null}
      {storyMenu && !menu.state ? (
        <ContextMenu
          x={storyMenu.x}
          y={storyMenu.y}
          returnFocus={storyMenu.target}
          onClose={() => setStoryMenu(null)}
          groups={storyMenuGroups()}
        />
      ) : null}
    </>
  );
}

function FramePage({
  panel,
  index,
  count,
  panels,
  known,
  sources,
  used,
  base,
  onSelect,
  registerSave,
}: {
  panel: Panel;
  index: number;
  count: number;
  panels: Panel[];
  known: KnownVariables;
  sources: PromptSources;
  used: PromptUsage;
  /** The story's starting template (故事梗概 / 起手模板), '' when none. */
  base: string;
  onSelect: (id: string | undefined) => void;
  registerSave: (save: AutosaveController | null) => void;
}) {
  const { t } = useTranslation();
  const { episode } = useEpisodeContext();
  const eid = episode.id!;
  const patch = usePatchPanel(eid);
  const batch = useBatchPatchPanels(eid);
  const reorder = useReorderPanels(eid);
  const duplicate = useDuplicatePanel(eid);
  const remove = useDeletePanel(eid);
  const initial = useMemo(
    () => ({
      description: panel.description,
      overrides: panel.overrides,
      dialogues: panel.dialogues,
    }),
    [panel],
  );
  const draft = useAutoDraft(initial, (changes) =>
    patch.mutateAsync({ panelId: panel.id!, changes }),
  );
  useEffect(() => {
    registerSave(draft);
    return () => registerSave(null);
  }, [registerSave, draft.flush]);
  const ov = draft.value.overrides;
  const commit = () => {
    void draft.flushAll().catch(toastError);
  };
  const setOverrides = (changes: Partial<PanelOverrides>) =>
    draft.change((previous) => ({ ...previous, overrides: { ...previous.overrides, ...changes } }));
  const name = {
    value: draft.value.description,
    onChange: (description: string) => draft.change((previous) => ({ ...previous, description })),
    onBlur: commit,
  };
  const prompt = {
    value: ov.raw_prompt ?? '',
    onChange: (raw_prompt: string) => setOverrides({ raw_prompt }),
    onBlur: commit,
  };
  const negative = {
    value: ov.raw_negative ?? '',
    onChange: (raw_negative: string) => setOverrides({ raw_negative: raw_negative || null }),
    onBlur: commit,
  };
  const text = {
    value: captionText(draft.value.dialogues),
    onChange: (value: string) =>
      draft.change((previous) => ({
        ...previous,
        dialogues: replaceCaption(previous.dialogues, value),
      })),
    onBlur: commit,
  };

  const move = async (dir: -1 | 1) => {
    try {
      await draft.flushAll();
    } catch (error) {
      toastError(error);
      return;
    }
    const ids = panels.map((p) => p.id!);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids, { onError: toastError });
  };
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const values = (ov.values ?? {}) as Record<string, unknown>;
  const setValue = (key: string, v: string) => {
    const next = { ...values };
    if (v.trim() === '') delete next[key];
    else next[key] = Number(v);
    setOverrides({ values: next });
  };

  return (
    <section
      className="workshop-page"
      data-editor-key={panel.id}
      onKeyDown={(event) => {
        if (
          !shortcutBlocked(event, event.currentTarget, true) &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 's'
        ) {
          event.preventDefault();
          commit();
        }
      }}
    >
      <AutoSaveGuard save={draft} includeSearch />
      <div className="row" style={{ marginBottom: 10 }}>
        <SaveState state={draft.state} />
        <span className="grow" />
        <button
          type="button"
          className="btn ghost small"
          disabled={!draft.busy() || draft.state === 'saving'}
          onClick={commit}
        >
          {t('common.save')}
        </button>
      </div>
      <div className="workshop-page-title">
        <input
          value={name.value}
          aria-label={t('ws.story.frameName')}
          onChange={(e) => name.onChange(e.target.value)}
          onBlur={name.onBlur}
        />
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.moveUp')}
          aria-label={t('ws.story.moveUp')}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <Icon name="up" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.moveDown')}
          aria-label={t('ws.story.moveDown')}
          disabled={index === count - 1}
          onClick={() => move(1)}
        >
          <Icon name="down" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.copy')}
          aria-label={t('ws.story.copy')}
          onClick={async () => {
            try {
              await draft.flushAll();
            } catch (error) {
              toastError(error);
              return;
            }
            duplicate.mutate(panel.id!, {
              onSuccess: (ep) => {
                const sorted = [...ep.panels].sort((a, b) => a.order - b.order);
                onSelect(sorted[index + 1]?.id);
              },
              onError: toastError,
            });
          }}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.remove')}
          aria-label={t('ws.story.remove')}
          onClick={async () => {
            if (!(await confirm({ title: t('ws.story.removeConfirm'), danger: true }))) return;
            await draft.flushAll().catch(() => undefined);
            remove.mutate(panel.id!, {
              onSuccess: () => {
                draft.discard();
                onSelect(panels[index + 1]?.id ?? panels[index - 1]?.id);
              },
              onError: toastError,
            });
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="negative-heading prompt-heading">
        <label htmlFor="workshop-frame-prompt">{t('ws.story.prompt')}</label>
        {base && !prompt.value.trim() ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              prompt.onChange(base);
              document.getElementById('workshop-frame-prompt')?.focus();
            }}
          >
            <Icon name="plus" sm />
            {t('ws.story.applyBase')}
          </button>
        ) : null}
      </div>
      <PromptSurface
        id="workshop-frame-prompt"
        className="workshop-prompt"
        known={known}
        sources={sources}
        used={used}
        placeholder={t('ws.story.promptHint')}
        {...prompt}
      />
      <div className="negative-heading">
        <label htmlFor="workshop-frame-negative">{t('ws.story.negative')}</label>
        <button
          type="button"
          className="btn small ghost"
          disabled={batch.isPending}
          onClick={async () => {
            // Save this frame's pending edits first so the autosave cannot land after the batch.
            try {
              await draft.flushAll();
              await batch.mutateAsync({
                panelIds: panels.map((p) => p.id!),
                changes: { overrides: { raw_negative: negative.value || null } },
              });
              toast(t('ws.story.negativeAllDone', { n: panels.length }));
            } catch (error) {
              toastError(error);
            }
          }}
        >
          <Icon name="copy" sm />
          {t('ws.story.negativeAll')}
        </button>
      </div>
      <PromptSurface
        id="workshop-frame-negative"
        className="workshop-negative"
        known={known}
        sources={sources}
        used={used}
        placeholder={t('ws.story.negativeHint')}
        {...negative}
      />
      <div className="field">
        <label className="label" htmlFor="workshop-frame-caption">
          {t('ws.story.caption')}
        </label>
        <PromptSurface
          id="workshop-frame-caption"
          className="workshop-caption"
          known={known}
          sources={sources}
          used={used}
          prose
          {...text}
        />
      </div>
      <details className="quiet-advanced">
        <summary>{t('ws.story.params')}</summary>
        <p className="help workshop-parameter-notice">{t('ws.story.paramsHelp')}</p>
        <div className="grid2">
          {(
            [
              ['width', ov.width, (v: string) => setOverrides({ width: num(v) })],
              ['height', ov.height, (v: string) => setOverrides({ height: num(v) })],
              ['steps', values.steps as number | undefined, (v: string) => setValue('steps', v)],
              ['cfg', values.cfg as number | undefined, (v: string) => setValue('cfg', v)],
              ['seed', ov.seed, (v: string) => setOverrides({ seed: num(v) })],
            ] as const
          ).map(([key, value, set]) => (
            <div className="field" key={key}>
              <label className="label" htmlFor={`frame-${key}`}>
                {t(`ws.story.param.${key}`)}
              </label>
              <input
                id={`frame-${key}`}
                type="number"
                value={value ?? ''}
                placeholder={t('ws.story.paramDefault')}
                onChange={(e) => set(e.target.value)}
                onBlur={commit}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
