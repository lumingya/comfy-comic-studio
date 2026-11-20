import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Panel } from '../../api/types';
import { Icon } from '../../app/icons';
import type { Selection } from '../../app/selection';
import type { useDesktopSelection } from '../../app/useDesktopSelection';
import { captionText } from './caption';
import { MAX_FRAMES } from './frameBatch';
import { variableUsage } from './PromptSurface';
import { isEmptyFrame, promptOf } from './storyboardPrompts';
import './storyboard-frames.css';

type FrameFilter = 'all' | 'empty' | 'variables';

function FrameRow({
  id,
  title,
  index,
  active,
  selected,
  context,
  showHandle,
  reordering,
}: {
  id: string;
  title: string;
  index: number;
  active: boolean;
  selected: boolean;
  context: boolean;
  showHandle: boolean;
  reordering: boolean;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !showHandle || reordering });
  return (
    <div
      ref={setNodeRef}
      className="workshop-frame-row"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      {showHandle ? (
        <button
          type="button"
          className="btn ghost workshop-reorder-handle"
          ref={setActivatorNodeRef}
          data-reorder-handle
          title={t('ws.story.dragFrame', { n: index + 1 })}
          {...attributes}
          {...listeners}
          aria-label={t('ws.story.dragFrame', { n: index + 1 })}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className={`${active ? 'active' : ''} ${selected ? 'checked' : ''} ${context ? 'is-context' : ''}`}
        data-selection-id={id}
        data-selection-open
        aria-selected={selected || undefined}
        aria-current={active ? 'true' : undefined}
        title={title}
      >
        <small>{String(index + 1).padStart(2, '0')}</small>
        <span>{title}</span>
      </button>
    </div>
  );
}

export function StoryboardFramesList({
  panels,
  panelIds,
  activeId,
  selection,
  desktop,
  contextId,
  adding,
  importing,
  reordering,
  onDragStart,
  onReorder,
  onAdd,
  onBatch,
}: {
  panels: Panel[];
  panelIds: string[];
  activeId?: string;
  selection: Selection;
  desktop: ReturnType<typeof useDesktopSelection>;
  contextId?: string;
  adding: boolean;
  importing: boolean;
  reordering: boolean;
  onDragStart: () => void;
  onReorder: (id: string, over: string) => Promise<void>;
  onAdd: () => void;
  onBatch: () => void;
}) {
  const { t } = useTranslation();
  const [frameQuery, setFrameQuery] = useState('');
  const [frameFilter, setFrameFilter] = useState<FrameFilter>('all');
  const query = frameQuery.trim().toLocaleLowerCase();
  const filtered = frameFilter !== 'all' || !!query;
  const showHandle = !filtered && panels.length > 1;
  const { visible, filled } = useMemo(() => {
    let filled = 0;
    const visible = panels.flatMap((panel, index) => {
      const empty = isEmptyFrame(panel);
      if (!empty) filled += 1;
      if (frameFilter === 'empty' && !empty) return [];
      const prompt = promptOf(panel);
      const negative = panel.overrides.raw_negative ?? '';
      const caption = captionText(panel.dialogues);
      if (frameFilter === 'variables' && !variableUsage([prompt, negative, caption]).size)
        return [];
      if (query) {
        const text = [panel.description, prompt, negative, caption].join('\n').toLocaleLowerCase();
        if (!text.includes(query)) return [];
      }
      return [{ panel, index }];
    });
    return { visible, filled };
  }, [panels, frameFilter, query]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const dndId = useId();
  const dragOrder = useRef<string[] | null>(null);
  const endDrag = ({ active, over }: DragEndEvent) => {
    const order = dragOrder.current;
    dragOrder.current = null;
    if (
      !showHandle ||
      !over ||
      active.id === over.id ||
      !order ||
      panelIds.length !== order.length ||
      panelIds.some((id, i) => id !== order[i])
    )
      return;
    void onReorder(String(active.id), String(over.id));
  };
  const selectedCount = (desktop.snapshot ?? selection.ids).length;

  return (
    <nav className="workshop-frames" aria-label={t('ws.story.framesLabel')}>
      <div className="workshop-frame-filters">
        <input
          type="search"
          aria-label={t('ws.story.searchFrames')}
          placeholder={t('ws.story.searchFrames')}
          value={frameQuery}
          onChange={(event) => setFrameQuery(event.target.value)}
        />
        <select
          aria-label={t('ws.story.filterFrames')}
          value={frameFilter}
          onChange={(event) => setFrameFilter(event.target.value as FrameFilter)}
        >
          <option value="all">{t('ws.story.frameFilter.all')}</option>
          <option value="empty">{t('ws.story.frameFilter.empty')}</option>
          <option value="variables">{t('ws.story.frameFilter.variables')}</option>
        </select>
        <p className="help workshop-frame-summary">
          {t('ws.story.frameSummary', { filled, total: panels.length })}
          {filtered ? <> · {t('ws.story.frameMatches', { count: visible.length })}</> : null}
        </p>
      </div>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={(args) => {
          const bounds = desktop.ref.current?.getBoundingClientRect();
          const point = args.pointerCoordinates;
          if (
            bounds &&
            point &&
            (point.x < bounds.left ||
              point.x > bounds.right ||
              point.y < bounds.top ||
              point.y > bounds.bottom)
          )
            return [];
          return closestCenter(args);
        }}
        accessibility={{
          screenReaderInstructions: { draggable: t('ws.story.dragInstructions') },
          announcements: {
            onDragStart: () => t('ws.story.dragPickedUp'),
            onDragOver: ({ over }) =>
              over
                ? t('ws.story.dragPosition', { n: panelIds.indexOf(String(over.id)) + 1 })
                : undefined,
            onDragEnd: () => t('ws.story.dragReleased'),
            onDragCancel: () => t('ws.story.dragCanceled'),
          },
        }}
        onDragStart={() => {
          dragOrder.current = panelIds;
          onDragStart();
        }}
        onDragEnd={endDrag}
        onDragCancel={() => {
          dragOrder.current = null;
        }}
      >
        <SortableContext items={panelIds} strategy={verticalListSortingStrategy}>
          <div
            className="workshop-frames-list desktop-list"
            ref={desktop.ref}
            tabIndex={0}
            onClickCapture={desktop.onClickCapture}
            onContextMenu={desktop.onContextMenu}
            onPointerDown={desktop.onPointerDown}
            onDragStartCapture={desktop.onDragStartCapture}
          >
            {selectedCount ? (
              <div className="selection-bar" role="status">
                <span>{t('interaction.selected', { count: selectedCount })}</span>
                <button type="button" className="btn ghost small" onClick={selection.clear}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : null}
            {visible.length === 0 ? (
              <p className="help" role="status">
                {t('ws.story.noFrameMatches')}
              </p>
            ) : null}
            {visible.map(({ panel, index }) => (
              <FrameRow
                key={panel.id}
                id={panel.id!}
                title={panel.description || t('ws.story.frameN', { n: index + 1 })}
                index={index}
                active={panel.id === activeId}
                selected={selection.has(panel.id!)}
                context={contextId === panel.id}
                showHandle={showHandle}
                reordering={reordering}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="workshop-frames-actions">
        <button
          type="button"
          className="btn small"
          disabled={adding || panels.length >= MAX_FRAMES}
          onClick={onAdd}
        >
          <Icon name="plus" sm />
          {t('ws.story.addFrame')}
        </button>
        <button
          type="button"
          className="btn small"
          disabled={importing || panels.length >= MAX_FRAMES}
          aria-haspopup="dialog"
          onClick={onBatch}
        >
          <Icon name="list" sm />
          {t('ws.story.addFrames')}
        </button>
      </div>
    </nav>
  );
}
