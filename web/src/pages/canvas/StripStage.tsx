import type Konva from 'konva';
import { useEffect, useRef } from 'react';
import { Group, Image as KImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import { assetUrl } from '../../api/client';
import type { LetteringLayer, Strip } from '../../api/types';
import { useImage } from '../board/MaskCanvas';

type Box = [number, number, number, number];
export type Selection = { type: 'panel' | 'letter'; id: string } | null;

function PanelImage(props: {
  id: string;
  box: Box;
  assetId: string | undefined;
  crop: Box | undefined;
  selected: boolean;
  onSelect: () => void;
  onChange: (box: Box) => void;
}) {
  const image = useImage(props.assetId ? assetUrl(props.assetId, 1200) : null);
  const [x0, y0, x1, y1] = props.box;
  const w = x1 - x0;
  const h = y1 - y0;
  let crop: { x: number; y: number; width: number; height: number } | undefined;
  if (image) {
    if (props.crop) {
      const [cx0, cy0, cx1, cy1] = props.crop;
      crop = {
        x: cx0 * image.width,
        y: cy0 * image.height,
        width: (cx1 - cx0) * image.width,
        height: (cy1 - cy0) * image.height,
      };
    } else {
      // Centre-crop to the box ratio, like the server compositor.
      const r = w / h;
      const cw = Math.min(image.width, image.height * r);
      const ch = cw / r;
      crop = { x: (image.width - cw) / 2, y: (image.height - ch) / 2, width: cw, height: ch };
    }
  }
  return (
    <Group
      id={`panel-${props.id}`}
      x={x0}
      y={y0}
      draggable
      onMouseDown={props.onSelect}
      onTap={props.onSelect}
      onDragEnd={(e) =>
        props.onChange([e.target.x(), e.target.y(), e.target.x() + w, e.target.y() + h])
      }
      onTransformEnd={(e) => {
        const n = e.target;
        const nw = Math.max(40, w * n.scaleX());
        const nh = Math.max(40, h * n.scaleY());
        n.scale({ x: 1, y: 1 });
        props.onChange([n.x(), n.y(), n.x() + nw, n.y() + nh]);
      }}
    >
      {image ? (
        <KImage image={image} width={w} height={h} crop={crop} />
      ) : (
        <Rect width={w} height={h} fill="#d9ddd6" />
      )}
      <Rect
        width={w}
        height={h}
        stroke={props.selected ? '#355e40' : '#1a1a1a'}
        strokeWidth={props.selected ? 4 : 2}
      />
    </Group>
  );
}

function Letter(props: {
  layer: LetteringLayer;
  selected: boolean;
  onSelect: () => void;
  onChange: (box: Box) => void;
}) {
  const { layer } = props;
  const [x0, y0, x1, y1] = layer.box as Box;
  const w = x1 - x0;
  const h = y1 - y0;
  const bubble = layer.kind === 'speech' || layer.kind === 'thought';
  const boxed = layer.kind === 'narration' || layer.kind === 'caption';
  const size = layer.font_size ?? 22;
  return (
    <Group
      id={`letter-${layer.id}`}
      x={x0}
      y={y0}
      draggable
      onMouseDown={props.onSelect}
      onTap={props.onSelect}
      onDragEnd={(e) =>
        props.onChange([e.target.x(), e.target.y(), e.target.x() + w, e.target.y() + h])
      }
      onTransformEnd={(e) => {
        const n = e.target;
        const nw = Math.max(24, w * n.scaleX());
        const nh = Math.max(24, h * n.scaleY());
        n.scale({ x: 1, y: 1 });
        props.onChange([n.x(), n.y(), n.x() + nw, n.y() + nh]);
      }}
    >
      {bubble || boxed ? (
        <Rect
          width={w}
          height={h}
          fill={boxed ? '#fbf8ef' : '#ffffff'}
          stroke="#1a1a1a"
          strokeWidth={2}
          cornerRadius={bubble ? Math.min(w, h) / 2 : 2}
          dash={layer.kind === 'thought' ? [6, 5] : undefined}
        />
      ) : null}
      <Text
        text={layer.text}
        width={w}
        height={h}
        padding={bubble ? Math.min(w, h) * 0.18 : 8}
        align="center"
        verticalAlign="middle"
        fontSize={layer.kind === 'sfx' ? size + 16 : size}
        fontStyle={layer.kind === 'sfx' || layer.kind === 'caption' ? 'bold' : 'normal'}
        fill={layer.kind === 'sfx' ? '#b44444' : '#1a1a1a'}
        stroke={layer.kind === 'sfx' ? '#ffffff' : undefined}
        strokeWidth={layer.kind === 'sfx' ? 1 : 0}
      />
      {props.selected ? (
        <Rect width={w} height={h} stroke="#355e40" strokeWidth={2} dash={[4, 4]} />
      ) : null}
    </Group>
  );
}

export function StripStage(props: {
  strip: Strip;
  images: Record<string, string>;
  scale: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPanelBox: (id: string, box: Box) => void;
  onLetterBox: (id: string, box: Box) => void;
}) {
  const { strip, scale } = props;
  const stage = useRef<Konva.Stage>(null);
  const tr = useRef<Konva.Transformer>(null);

  useEffect(() => {
    const sel = props.selection;
    const node = sel ? stage.current?.findOne(`#${sel.type}-${sel.id}`) : undefined;
    tr.current?.nodes(node ? [node] : []);
    tr.current?.getLayer()?.batchDraw();
  }, [props.selection, strip]);

  const height = Math.max(strip.height, 400);
  return (
    <Stage
      ref={stage}
      width={strip.width * scale}
      height={height * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(e) => e.target === e.target.getStage() && props.onSelect(null)}
    >
      <Layer>
        <Rect width={strip.width} height={height} fill={strip.background} listening={false} />
        {Object.entries(strip.panel_boxes).map(([id, box]) => (
          <PanelImage
            key={id}
            id={id}
            box={box as Box}
            assetId={props.images[id]}
            crop={strip.crops[id] as Box | undefined}
            selected={props.selection?.type === 'panel' && props.selection.id === id}
            onSelect={() => props.onSelect({ type: 'panel', id })}
            onChange={(b) => props.onPanelBox(id, b)}
          />
        ))}
        {strip.lettering.map((l) => (
          <Letter
            key={l.id}
            layer={l}
            selected={props.selection?.type === 'letter' && props.selection.id === l.id}
            onSelect={() => props.onSelect({ type: 'letter', id: l.id })}
            onChange={(b) => props.onLetterBox(l.id, b)}
          />
        ))}
        <Transformer ref={tr} rotateEnabled={false} keepRatio={false} flipEnabled={false} />
      </Layer>
    </Stage>
  );
}
