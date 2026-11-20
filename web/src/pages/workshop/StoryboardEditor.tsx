import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.isComposing) return;
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
