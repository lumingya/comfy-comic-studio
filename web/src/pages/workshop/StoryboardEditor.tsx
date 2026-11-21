import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { shortcutBlocked } from '../../app/shortcuts';
import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import { useContextMenu } from '../../components/ContextMenu';
import { ResizableSplit } from '../../components/ResizableSplit';
import { useEpisodeContext } from '../episode/EpisodePage';
import { TransferDialog } from '../longform/TransferDialog';
import { BatchFramesDialog } from './BatchFramesDialog';
import { FramePage } from './FramePage';
import { StoryboardFramesList } from './StoryboardFramesList';
import { StoryboardMenus } from './StoryboardMenus';
import { variableUsage } from './PromptSurface';
import { promptOf, useKnownVariables, usePromptSources } from './storyboardPrompts';
import { useStoryboardFrames } from './useStoryboardFrames';

export { useKnownVariables, usePromptSources } from './storyboardPrompts';

export default function StoryboardEditor() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const known = useKnownVariables(series);
  const sources = usePromptSources(series);
  const frames = useStoryboardFrames(episode);
  const {
    active,
    panels,
    panelIds,
    choose,
    removeSelected,
    registerSave,
    selection,
    basePrompt,
    addFrame,
    openBatch,
    adding,
    importing,
    remembering,
    dropFrame,
    moveFrame,
    reordering,
    batch,
    setBatch,
    addBatch,
    transfer,
    setTransfer,
  } = frames;
  const menu = useContextMenu<DesktopContext>();
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ id: string; target: 'prompt' | 'list' } | null>(null);
  const used = useMemo(
    () => variableUsage(panels.flatMap((p) => [promptOf(p), p.overrides.raw_negative ?? ''])),
    [panels],
  );
  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: true,
    pinned: false,
    contextOpen: !!menu.state,
    onExit: selection.clear,
    onOpen: (id) => {
      void choose(id).then((changed) => {
        if (changed && editorRef.current?.closest('.resizable-split[data-stacked]'))
          editorRef.current.querySelector('.workshop-page')?.scrollIntoView({ block: 'start' });
      });
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
  useLayoutEffect(() => {
    const focus = pendingFocus.current;
    if (!focus || focus.id !== active?.id) return;
    pendingFocus.current = null;
    const next =
      focus.target === 'prompt'
        ? editorRef.current?.querySelector<HTMLElement>('#workshop-frame-prompt')
        : [
            ...(desktop.ref.current?.querySelectorAll<HTMLElement>('[data-selection-id]') ?? []),
          ].find((row) => row.dataset.selectionId === focus.id);
    next?.focus();
  }, [active?.id, desktop.ref]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const site = editorRef.current;
      const target = event.target instanceof Element ? event.target : null;
      const inEditor = !!target?.closest('[data-editor-key]');
      const inList = !!target?.closest('.workshop-frames-list');
      if (
        !site?.contains(target) ||
        (!inEditor && !inList) ||
        !active?.id ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.keyCode === 229 ||
        shortcutBlocked(event, site, true) ||
        !['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)
      )
        return;
      event.preventDefault();
      if (event.repeat || pendingFocus.current) return;
      const visible = [
        ...(desktop.ref.current?.querySelectorAll<HTMLElement>('[data-selection-id]') ?? []),
      ].map((row) => row.dataset.selectionId!);
      const index = visible.indexOf(active.id);
      const backwards = event.key === 'ArrowUp';
      const next =
        index < 0 ? visible.at(backwards ? -1 : 0) : visible[index + (backwards ? -1 : 1)];
      if (!next) {
        if (event.key === 'Enter' && inEditor) void choose(active.id);
        return;
      }
      if (event.key === 'Enter' || inList)
        pendingFocus.current = { id: next, target: event.key === 'Enter' ? 'prompt' : 'list' };
      void choose(next).then((ok) => {
        if (!ok && pendingFocus.current?.id === next) pendingFocus.current = null;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  return (
    <>
      <ResizableSplit
        className="workshop-editor"
        ref={editorRef}
        storageKey="storyboard"
        label={t('ws.story.framesLabel')}
        defaultWidth={240}
      >
        <StoryboardFramesList
          panels={panels}
          panelIds={panelIds}
          activeId={active?.id}
          selection={selection}
          desktop={desktop}
          contextId={menu.state?.payload.focusId}
          adding={adding}
          importing={importing}
          reordering={reordering}
          onDragStart={menu.close}
          onReorder={dropFrame}
          onAdd={() => addFrame()}
          onBatch={openBatch}
        />
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
            moveFrame={moveFrame}
            reordering={reordering}
          />
        ) : (
          <section className="workshop-page is-empty">
            <p className="help">{t('ws.story.noFrames')}</p>
          </section>
        )}
      </ResizableSplit>
      {batch ? (
        <BatchFramesDialog
          existing={panels.length}
          prompts={panels.map(promptOf)}
          remembered={basePrompt()}
          known={known}
          sources={sources}
          busy={importing || remembering}
          onClose={() => setBatch(false)}
          onSubmit={(result) => void addBatch(result)}
        />
      ) : null}
      <StoryboardMenus
        episode={episode}
        series={series}
        editorRef={editorRef}
        menu={menu}
        frames={frames}
      />
      {transfer ? (
        <TransferDialog
          episode={transfer.episode}
          panelIds={transfer.ids}
          onClose={() => setTransfer(null)}
          onDone={selection.clear}
        />
      ) : null}
    </>
  );
}
