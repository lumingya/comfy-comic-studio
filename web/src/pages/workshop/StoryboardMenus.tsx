import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { keys } from '../../api/keys';
import { useCreateEpisode, usePatchEpisode } from '../../api/series';
import type { Episode, Series } from '../../api/types';
import { Icon } from '../../app/icons';
import type { DesktopContext } from '../../app/useDesktopSelection';
import {
  ContextMenu,
  type ContextGroup,
  type ContextItem,
  type useContextMenu,
} from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { useStoryboardExport } from './ExportPicker';
import { MAX_FRAMES } from './frameBatch';
import {
  askAssetTitle,
  createStoryboard,
  exportStoryboard,
  importStoryboards,
} from './storyActions';
import { isEmptyFrame, promptOf } from './storyboardPrompts';
import type { useStoryboardFrames } from './useStoryboardFrames';
import { workshopHref } from './workshopSource';
/** Right-clicks on these keep the browser menu (legacy workshopContextSpec). */
const NATIVE_MENU =
  'input,textarea,select,[contenteditable]:not([contenteditable="false"]),a[href],dialog,[role=dialog],.context-menu';

export function StoryboardMenus({
  episode,
  series,
  editorRef,
  menu,
  frames,
}: {
  episode: Episode;
  series: Series;
  editorRef: RefObject<HTMLDivElement | null>;
  menu: ReturnType<typeof useContextMenu<DesktopContext>>;
  frames: ReturnType<typeof useStoryboardFrames>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const createBoard = useCreateEpisode(series.id!);
  const patchBoard = usePatchEpisode(episode.id!);
  const kitId = series.kind === 'kit' ? series.id : undefined;
  const exporter = useStoryboardExport(series.id, episode.id);
  const {
    active,
    panels,
    selection,
    basePrompt,
    addFrame,
    openBatch,
    choose,
    applyBase,
    copySelected,
    openTransfer,
    moveFrame,
    removeSelected,
    adding,
    importing,
    duplicating,
    removing,
    reordering,
  } = frames;
  // Legacy workshopStoryContextItems: right-clicking anywhere else on the 分镜工坊 page (the
  // heading, the 当前分镜 row, the space around the editor) opens the storyboard menu; the frame
  // editor opens the menu of the frame being edited.  Bound natively on the page so the frames
  // list (which owns its own menu) is not affected.
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
            disabled: adding || panels.length >= MAX_FRAMES,
            onSelect: () => addFrame(),
          },
          {
            label: t('ws.story.menu.addFramesDots'),
            icon: <Icon name="list" sm />,
            disabled: importing || panels.length >= MAX_FRAMES,
            onSelect: openBatch,
          },
          {
            label: t('ws.story.menu.selectAll'),
            icon: <Icon name="check" sm />,
            shortcut: 'Ctrl/⌘ A',
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
            onSelect: () =>
              navigate(workshopHref('/workshop/assembly', kitId, { story: episode.id })),
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
              navigate(workshopHref(`/workshop/story/${e.id}`, kitId));
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
              navigate(workshopHref(`/workshop/story/${last}`, kitId));
              toast(t('ws.imported', { count }));
            }),
          },
          {
            label: t('ws.story.menu.exportPickDots'),
            icon: <Icon name="upload" sm />,
            onSelect: exporter.open,
          },
        ],
      },
      {
        heading: t('ws.menu.switchTo'),
        items: [
          {
            label: t('ws.tab.presets'),
            icon: <Icon name="brush" sm />,
            onSelect: () => navigate(workshopHref('/workshop/presets', kitId)),
          },
          {
            label: t('ws.tab.assembly'),
            icon: <Icon name="play" sm />,
            onSelect: () => navigate(workshopHref('/workshop/assembly', kitId)),
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
              disabled: duplicating,
              onSelect: () => void copySelected(ids),
            },
            {
              label: t('longform.transfer'),
              icon: <Icon name="copy" sm />,
              onSelect: () => void openTransfer(ids),
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
              disabled: removing || ids.length >= panels.length,
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
            disabled: adding,
            onSelect: () => addFrame(focus.id!),
          },
          {
            label: t('ws.story.menu.copyOne'),
            icon: <Icon name="copy" sm />,
            disabled: duplicating,
            onSelect: () => void copySelected([focus.id!]),
          },
          {
            label: t('longform.transfer'),
            icon: <Icon name="copy" sm />,
            onSelect: () => void openTransfer([focus.id!]),
          },
          {
            label: t('ws.story.menu.moveUp'),
            icon: <Icon name="up" sm />,
            disabled: index === 0 || reordering,
            onSelect: () => void moveFrame(focus.id!, -1),
          },
          {
            label: t('ws.story.menu.moveDown'),
            icon: <Icon name="down" sm />,
            disabled: index >= panels.length - 1 || reordering,
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
            disabled: removing || panels.length <= 1,
            title: panels.length <= 1 ? t('ws.story.menu.keepOne') : undefined,
            onSelect: () => void removeSelected([focus.id!]),
          },
        ],
      },
    ];
  };

  return (
    <>
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
      {exporter.element}
    </>
  );
}
