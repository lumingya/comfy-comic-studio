import type Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { Image as KImage, Layer, Line, Rect, Stage } from 'react-konva';
import type { MaskShape } from './mask';

/** Load an image element for konva; null until decoded. */
export function useImage(src: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImage(null);
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return image;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Paint the repaint area over the take. Shapes are kept in 0–1 image fractions — exactly what the
 * server's `boxes` / `polygons` inpaint params expect — so the stage size never leaks into them.
 */
export function MaskCanvas(props: {
  src: string;
  tool: 'box' | 'lasso';
  shapes: MaskShape[];
  onChange: (shapes: MaskShape[]) => void;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const image = useImage(props.src);
  const [draft, setDraft] = useState<MaskShape | null>(null);
  const start = useRef<[number, number] | null>(null);
  if (!image)
    return (
      <div className="mask-stage loading">
        <span className="spinner" />
      </div>
    );

  const scale = Math.min(
    (props.maxWidth ?? 720) / image.width,
    (props.maxHeight ?? 560) / image.height,
    1,
  );
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);

  const pos = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): [number, number] => {
    const p = e.target.getStage()!.getPointerPosition()!;
    return [clamp(p.x / w), clamp(p.y / h)];
  };
  const down = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = pos(e);
    start.current = p;
    setDraft(
      props.tool === 'box'
        ? { kind: 'box', box: [p[0], p[1], p[0], p[1]] }
        : { kind: 'lasso', points: [p] },
    );
  };
  const move = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!draft || !start.current) return;
    const p = pos(e);
    if (draft.kind === 'box') {
      const [x0, y0] = start.current;
      setDraft({
        kind: 'box',
        box: [Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x0, p[0]), Math.max(y0, p[1])],
      });
    } else {
      setDraft({ kind: 'lasso', points: [...draft.points, p] });
    }
  };
  const up = () => {
    if (draft) {
      const big =
        draft.kind === 'box'
          ? draft.box[2] - draft.box[0] > 0.01 && draft.box[3] - draft.box[1] > 0.01
          : draft.points.length >= 3;
      if (big) props.onChange([...props.shapes, draft]);
    }
    setDraft(null);
    start.current = null;
  };

  const render = (s: MaskShape, i: number | string) =>
    s.kind === 'box' ? (
      <Rect
        key={i}
        x={s.box[0] * w}
        y={s.box[1] * h}
        width={(s.box[2] - s.box[0]) * w}
        height={(s.box[3] - s.box[1]) * h}
        fill="rgba(233,146,146,0.38)"
        stroke="#e99292"
        strokeWidth={1.5}
      />
    ) : (
      <Line
        key={i}
        points={s.points.flatMap(([x, y]) => [x * w, y * h])}
        closed
        fill="rgba(233,146,146,0.38)"
        stroke="#e99292"
        strokeWidth={1.5}
      />
    );

  return (
    <Stage
      width={w}
      height={h}
      className="mask-stage"
      onMouseDown={down}
      onMouseMove={move}
      onMouseUp={up}
      onMouseLeave={up}
      onTouchStart={down}
      onTouchMove={move}
      onTouchEnd={up}
    >
      <Layer listening={false}>
        <KImage image={image} width={w} height={h} />
      </Layer>
      <Layer listening={false}>
        {props.shapes.map(render)}
        {draft ? render(draft, 'draft') : null}
      </Layer>
    </Stage>
  );
}
