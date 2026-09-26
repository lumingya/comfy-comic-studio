import type Konva from 'konva';
import { Circle, Ellipse, Group, Line, Rect, Text } from 'react-konva';
import type { LetteringLayer } from '../../api/types';
import { DEFAULT_STYLE, extent, glyphLayout } from './sfx';
import { cellCenters, columns } from './vertical';

type Box = [number, number, number, number];
type Pt = [number, number];

/** Server `layout.Style` defaults, so the canvas previews at export size. */
export const FONT = { text: 27, caption: 22, sfx: 43, gap: 7 };
const FAMILY = "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";

export function fontSize(layer: LetteringLayer): number {
  if (layer.font_size) return layer.font_size;
  return layer.kind === 'caption' ? FONT.caption : layer.kind === 'sfx' ? FONT.sfx : FONT.text;
}

/** Speech tail polygon in group coordinates (mirrors `layout.draw_bubble`). */
export function tailPoints(w: number, h: number, tip: Pt): number[] {
  const cx = w / 2;
  const cy = h / 2;
  const ang = Math.atan2(tip[1] - cy, tip[0] - cx);
  const bx = cx + (w / 2) * 0.8 * Math.cos(ang);
  const by = cy + (h / 2) * 0.8 * Math.sin(ang);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  return [bx + nx * 14, by + ny * 14, tip[0], tip[1], bx - nx * 14, by - ny * 14];
}

function Bubble(props: { layer: LetteringLayer; w: number; h: number }) {
  const { layer, w, h } = props;
  const [x0, y0] = layer.box;
  const tip: Pt | null = layer.tail_to ? [layer.tail_to[0] - x0, layer.tail_to[1] - y0] : null;
  if (layer.kind === 'caption')
    return <Rect width={w} height={h} fill="#141414" listening={false} />;
  if (layer.kind === 'narration')
    return <Rect width={w} height={h} fill="#fffaec" stroke="#111" strokeWidth={3} />;
  const dots =
    tip && layer.kind === 'thought'
      ? [0.35, 0.75].map((t, i) => {
          const ang = Math.atan2(tip[1] - h / 2, tip[0] - w / 2);
          const ex = w / 2 + (w / 2) * Math.cos(ang);
          const ey = h / 2 + (h / 2) * Math.sin(ang);
          return (
            <Circle
              key={i}
              x={ex + (tip[0] - ex) * t}
              y={ey + (tip[1] - ey) * t}
              radius={i ? 5 : 9}
              fill="#fff"
              stroke="#111"
              strokeWidth={2}
            />
          );
        })
      : null;
  return (
    <>
      {tip && layer.kind === 'speech' ? (
        <Line points={tailPoints(w, h, tip)} closed fill="#fff" stroke="#111" strokeWidth={3} />
      ) : null}
      <Ellipse
        x={w / 2}
        y={h / 2}
        radiusX={w / 2}
        radiusY={h / 2}
        fill="#fff"
        stroke="#111"
        strokeWidth={3}
      />
      {tip && layer.kind === 'speech' ? (
        <Line {...seam(w, h, tip)} closed fill="#fff" listening={false} />
      ) : null}
      {dots}
    </>
  );
}

/** Covers the ellipse outline where the tail joins, like the server's seam polygon. */
function seam(w: number, h: number, tip: Pt): Partial<Konva.LineConfig> {
  const [ax, ay, , , bx, by] = tailPoints(w, h, tip);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const shrink = (x: number, y: number): Pt => [mx + (x - mx) * 0.78, my + (y - my) * 0.78];
  const inner = [
    ...shrink(ax, ay),
    mx + (tip[0] - mx) * 0.3,
    my + (tip[1] - my) * 0.3,
    ...shrink(bx, by),
  ];
  return { points: inner };
}

function Words(props: { layer: LetteringLayer; w: number; h: number }) {
  const { layer, w, h } = props;
  const size = fontSize(layer);
  const color = layer.kind === 'caption' ? '#fff' : '#111';
  const bold = layer.kind === 'caption';
  if (layer.vertical && layer.kind !== 'caption') {
    const cols = columns(layer.text, Math.max(2, Math.floor((h - 40) / (size * 1.05))));
    return (
      <>
        {cellCenters(cols, [w / 2, h / 2], size, FONT.gap).map((c, i) => (
          <Text
            key={i}
            text={c.ch}
            x={c.x - size / 2}
            y={c.y - size / 2}
            width={size}
            height={size}
            align="center"
            verticalAlign="middle"
            fontSize={size}
            fontFamily={FAMILY}
            fill={color}
            listening={false}
          />
        ))}
      </>
    );
  }
  const bubble = layer.kind === 'speech' || layer.kind === 'thought';
  const padX = bubble ? w * 0.14 : 12;
  return (
    <Text
      text={layer.text}
      x={padX}
      width={Math.max(20, w - padX * 2)}
      height={h}
      align="center"
      verticalAlign="middle"
      lineHeight={(size + FONT.gap) / size}
      fontSize={size}
      fontFamily={FAMILY}
      fontStyle={bold ? 'bold' : 'normal'}
      fill={color}
      listening={false}
    />
  );
}

export function Sfx(props: { layer: LetteringLayer }) {
  const { layer } = props;
  const style = layer.style ?? DEFAULT_STYLE;
  const glyphs = glyphLayout(layer.text, fontSize(layer), style, layer.vertical);
  const [hw, hh] = extent(glyphs, style.stroke_width);
  return (
    <>
      <Rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="transparent" />
      {glyphs.map((g, i) => {
        const cell = g.size * 1.6;
        return (
          <Text
            key={i}
            text={g.ch}
            x={g.x}
            y={g.y}
            offsetX={cell / 2}
            offsetY={cell / 2}
            width={cell}
            height={cell}
            rotation={g.angle}
            align="center"
            verticalAlign="middle"
            fontSize={g.size}
            fontFamily={FAMILY}
            fontStyle="bold"
            fill={style.fill}
            stroke={style.stroke_width ? style.stroke : undefined}
            strokeWidth={style.stroke_width * 2}
            fillAfterStrokeEnabled
            lineJoin="round"
            listening={false}
          />
        );
      })}
    </>
  );
}

export function Letter(props: {
  layer: LetteringLayer;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<LetteringLayer>) => void;
}) {
  const { layer } = props;
  const [x0, y0, x1, y1] = layer.box as Box;
  const w = x1 - x0;
  const h = y1 - y0;
  const common = {
    id: `letter-${layer.id}`,
    draggable: true,
    onMouseDown: props.onSelect,
    onTap: props.onSelect,
  };
  const shift = (dx: number, dy: number) => {
    const moved: Partial<LetteringLayer> = { box: [x0 + dx, y0 + dy, x1 + dx, y1 + dy] };
    if (layer.tail_to) moved.tail_to = [layer.tail_to[0] + dx, layer.tail_to[1] + dy];
    return moved;
  };
  if (layer.kind === 'sfx') {
    const style = layer.style ?? DEFAULT_STYLE;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return (
      <Group
        {...common}
        x={cx}
        y={cy}
        rotation={style.rotation}
        onDragEnd={(e) => props.onChange(shift(e.target.x() - cx, e.target.y() - cy))}
        onTransformEnd={(e) => {
          const n = e.target;
          const k = Math.max(0.2, (Math.abs(n.scaleX()) + Math.abs(n.scaleY())) / 2);
          const rotation = Math.round(((n.rotation() + 540) % 360) - 180);
          n.scale({ x: 1, y: 1 });
          const size = Math.round(Math.min(200, Math.max(10, fontSize(layer) * k)));
          const half = [(w / 2) * k, (h / 2) * k];
          props.onChange({
            font_size: size,
            style: { ...style, rotation },
            box: [n.x() - half[0], n.y() - half[1], n.x() + half[0], n.y() + half[1]],
          });
        }}
      >
        <Sfx layer={layer} />
      </Group>
    );
  }
  return (
    <Group
      {...common}
      x={x0}
      y={y0}
      onDragEnd={(e) => props.onChange(shift(e.target.x() - x0, e.target.y() - y0))}
      onTransformEnd={(e) => {
        const n = e.target;
        const nw = Math.max(24, w * n.scaleX());
        const nh = Math.max(24, h * n.scaleY());
        n.scale({ x: 1, y: 1 });
        props.onChange({ box: [n.x(), n.y(), n.x() + nw, n.y() + nh] });
      }}
    >
      <Bubble layer={layer} w={w} h={h} />
      <Words layer={layer} w={w} h={h} />
      {props.selected ? (
        <Rect width={w} height={h} stroke="#3f7550" strokeWidth={2} dash={[4, 4]} />
      ) : null}
      {layer.bridge_to ? (
        <Rect
          width={w}
          height={h}
          stroke="#2f6c9e"
          strokeWidth={1}
          dash={[2, 6]}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

/** Draggable tail tip, shown while a speech / thought bubble is selected. */
export function TailHandle(props: { tip: Pt; onChange: (tip: Pt) => void }) {
  return (
    <Circle
      x={props.tip[0]}
      y={props.tip[1]}
      radius={9}
      fill="#3f7550"
      stroke="#fff"
      strokeWidth={2}
      draggable
      onDragEnd={(e) => props.onChange([Math.round(e.target.x()), Math.round(e.target.y())])}
    />
  );
}
