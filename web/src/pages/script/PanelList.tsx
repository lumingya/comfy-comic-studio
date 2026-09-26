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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import type { Panel, Series } from '../../api/types';

function Row(props: {
  panel: Panel;
  index: number;
  active: boolean;
  names: Record<string, string>;
  cover?: string;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.panel.id!,
  });
  const p = props.panel;
  const cast = p.characters.map((c) => props.names[c.character_id] ?? c.character_id).join('、');
  const firstLine = p.dialogues[0]?.text;
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className={`panel-row ${props.active ? 'active' : ''}`}
    >
      <button
        className="drag-handle"
        aria-label={t('script.dragToReorder')}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button className="panel-row-body" onClick={props.onSelect}>
        <span className="panel-no mono">{String(props.index + 1).padStart(2, '0')}</span>
        {props.cover ? (
          <img className="panel-thumb" src={assetUrl(props.cover, 96)} alt="" loading="lazy" />
        ) : null}
        <span className="grow">
          <span className="row small" style={{ gap: 6 }}>
            <span className="chip">{t(`script.shots.${p.shot}`)}</span>
            {p.locked ? <Lock size={12} className="muted" /> : null}
            <span className="muted ellipsis">{cast}</span>
          </span>
          <span className="panel-row-text">{firstLine ? `「${firstLine}」` : p.description}</span>
        </span>
      </button>
    </li>
  );
}

/** Drag to reorder (mouse or keyboard); the parent persists the new order. */
export function PanelList(props: {
  panels: Panel[];
  series: Series;
  selected: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  /** panel id → adopted image, shown as a thumbnail. */
  covers?: Record<string, string>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = props.panels.map((p) => p.id!);
  const names = Object.fromEntries(props.series.bible.characters.map((c) => [c.id, c.name]));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    props.onReorder(
      arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))),
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="panel-list">
          {props.panels.map((p, i) => (
            <Row
              key={p.id}
              panel={p}
              index={i}
              names={names}
              cover={props.covers?.[p.id!]}
              active={p.id === props.selected}
              onSelect={() => props.onSelect(p.id!)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
