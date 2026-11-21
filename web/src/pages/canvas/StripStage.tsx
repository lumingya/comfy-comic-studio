import type Konva from 'konva';
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva';
import type { LetteringLayer, Panel, Strip } from '../../api/types';
import { colorAt, konvaStops, trackBands } from './backdrop';
import { Letter, TailHandle } from './Letter';
import { PanelImage } from './PanelImage';
import { selectedLetterIds, toggleLetter, type CanvasSelection } from './canvasTools';

type Box = [number, number, number, number];
export type Selection = CanvasSelection;

/** Keep the native scrollbar for the full strip, but allocate pixels only for the viewport. */
function useCanvasWindow(track: RefObject<HTMLDivElement | null>, height: number) {
  const [view, setView] = useState({ top: 0, height: Math.min(height, 600) });
  useLayoutEffect(() => {
    const node = track.current?.parentElement;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      const { paddingTop, paddingBottom } = getComputedStyle(node);
      const viewport = Math.max(
        1,
        node.clientHeight - parseFloat(paddingTop) - parseFloat(paddingBottom),
      );
      const visibleHeight = Math.min(viewport, height);
      const top = Math.max(0, Math.min(node.scrollTop, height - visibleHeight));
      setView((previous) =>
        previous.top === top && previous.height === visibleHeight
          ? previous
          : { top, height: visibleHeight },
      );
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    if (!observer) globalThis.addEventListener('resize', measure);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer?.disconnect();
      if (!observer) globalThis.removeEventListener('resize', measure);
      node.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [track, height]);
  return view;
}

export function StripStage(props: {
  strip: Strip;
  panels: Panel[];
  images: Record<string, string>;
  scale: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPanelBox: (id: string, box: Box, crop?: Box) => void;
  onLetter: (id: string, patch: Partial<LetteringLayer>) => void;
}) {
  const { strip, scale } = props;
  const stage = useRef<Konva.Stage>(null);
  const tr = useRef<Konva.Transformer>(null);
  const height = Math.max(strip.height, 400);
  const track = useRef<HTMLDivElement>(null);
  const viewport = useCanvasWindow(track, height * scale);
  const start = (viewport.top - 350) / scale;
  const end = (viewport.top + viewport.height + 350) / scale;
  const inWindow = (top: number, bottom: number) => top <= end && bottom >= start;
  const byId = useMemo(() => new Map(props.panels.map((p) => [p.id, p])), [props.panels]);
  const bands = useMemo(
    () => trackBands(props.panels, strip.panel_boxes, strip.background, height),
    [props.panels, strip.panel_boxes, strip.background, height],
  );
  const selected =
    props.selection?.type === 'letter'
      ? strip.lettering.find((l) => l.id === props.selection!.id)
      : undefined;
  const selectedIds = selectedLetterIds(props.selection);

  useLayoutEffect(() => {
    const sel = props.selection;
    const node =
      sel && selectedLetterIds(sel).length <= 1
        ? stage.current?.findOne(`#${sel.type}-${sel.id}`)
        : undefined;
    if (tr.current && tr.current.nodes()[0] !== node) tr.current.nodes(node ? [node] : []);
  }, [props.selection, strip, viewport.top, viewport.height]);

  const isSfx = selected?.kind === 'sfx';
  return (
    <div
      ref={track}
      className="canvas-track"
      style={{ width: strip.width * scale, height: height * scale }}
    >
      <div className="canvas-viewport">
        <Stage
          ref={stage}
          width={strip.width * scale}
          height={viewport.height}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={(e) => e.target === e.target.getStage() && props.onSelect(null)}
        >
          <Layer>
            <Rect
              width={strip.width}
              height={viewport.height / scale}
              fill={strip.background}
              listening={false}
            />
            <Group y={-viewport.top / scale}>
              {bands.map(
                (b, i) =>
                  inWindow(b.y0, b.y1) && (
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
                  ),
              )}
              {Object.entries(strip.panel_boxes).map(
                ([id, box]) =>
                  (inWindow(box[1], box[3]) ||
                    (props.selection?.type === 'panel' && props.selection.id === id)) && (
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
                      onChange={(b, crop) => props.onPanelBox(id, b, crop)}
                    />
                  ),
              )}
              {strip.lettering.map(
                (l) =>
                  (selectedIds.includes(l.id) ||
                    l.kind === 'sfx' ||
                    inWindow(
                      Math.min(l.box[1], l.tail_to?.[1] ?? l.box[1]),
                      Math.max(l.box[3], l.tail_to?.[1] ?? l.box[3]),
                    )) && (
                    <Letter
                      key={l.id}
                      layer={l}
                      selected={selectedIds.includes(l.id)}
                      onSelect={(e) =>
                        props.onSelect(
                          toggleLetter(
                            props.selection,
                            l.id,
                            e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey,
                          ),
                        )
                      }
                      onChange={(patch) => props.onLetter(l.id, patch)}
                    />
                  ),
              )}
              {selectedIds.length === 1 &&
              selected?.tail_to &&
              (selected.kind === 'speech' || selected.kind === 'thought') ? (
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
            </Group>
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
