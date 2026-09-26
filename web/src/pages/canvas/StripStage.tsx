import type Konva from 'konva';
import { useEffect, useMemo, useRef } from 'react';
import { Layer, Rect, Stage, Transformer } from 'react-konva';
import type { LetteringLayer, Panel, Strip } from '../../api/types';
import { colorAt, konvaStops, trackBands } from './backdrop';
import { Letter, TailHandle } from './Letter';
import { PanelImage } from './PanelImage';

type Box = [number, number, number, number];
export type Selection = { type: 'panel' | 'letter'; id: string } | null;

export function StripStage(props: {
  strip: Strip;
  panels: Panel[];
  images: Record<string, string>;
  scale: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPanelBox: (id: string, box: Box) => void;
  onLetter: (id: string, patch: Partial<LetteringLayer>) => void;
}) {
  const { strip, scale } = props;
  const stage = useRef<Konva.Stage>(null);
  const tr = useRef<Konva.Transformer>(null);
  const height = Math.max(strip.height, 400);
  const byId = useMemo(() => new Map(props.panels.map((p) => [p.id, p])), [props.panels]);
  const bands = useMemo(
    () => trackBands(props.panels, strip.panel_boxes, strip.background, height),
    [props.panels, strip.panel_boxes, strip.background, height],
  );
  const selected =
    props.selection?.type === 'letter'
      ? strip.lettering.find((l) => l.id === props.selection!.id)
      : undefined;

  useEffect(() => {
    const sel = props.selection;
    const node = sel ? stage.current?.findOne(`#${sel.type}-${sel.id}`) : undefined;
    tr.current?.nodes(node ? [node] : []);
    tr.current?.getLayer()?.batchDraw();
  }, [props.selection, strip]);

  const isSfx = selected?.kind === 'sfx';
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
        {bands.map((b, i) => (
          <Rect
            key={i}
            y={b.y0}
            width={strip.width}
            height={b.y1 - b.y0}
            listening={false}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 0, y: b.y1 - b.y0 }}
            fillLinearGradientColorStops={konvaStops(b.stops)}
          />
        ))}
        {Object.entries(strip.panel_boxes).map(([id, box]) => (
          <PanelImage
            key={id}
            id={id}
            box={box as Box}
            panel={byId.get(id)}
            assetId={props.images[id]}
            crop={strip.crops[id] as Box | undefined}
            selected={props.selection?.type === 'panel' && props.selection.id === id}
            edge={{
              top: colorAt(bands, box[1], strip.background),
              bottom: colorAt(bands, box[3], strip.background),
            }}
            onSelect={() => props.onSelect({ type: 'panel', id })}
            onChange={(b) => props.onPanelBox(id, b)}
          />
        ))}
        {strip.lettering.map((l) => (
          <Letter
            key={l.id}
            layer={l}
            selected={selected?.id === l.id}
            onSelect={() => props.onSelect({ type: 'letter', id: l.id })}
            onChange={(patch) => props.onLetter(l.id, patch)}
          />
        ))}
        {selected?.tail_to && (selected.kind === 'speech' || selected.kind === 'thought') ? (
          <TailHandle
            tip={selected.tail_to as [number, number]}
            onChange={(tail_to) => props.onLetter(selected.id, { tail_to })}
          />
        ) : null}
        <Transformer
          ref={tr}
          rotateEnabled={isSfx}
          keepRatio={isSfx}
          flipEnabled={false}
          rotationSnaps={[0, 90, 180, 270]}
        />
      </Layer>
    </Stage>
  );
}
