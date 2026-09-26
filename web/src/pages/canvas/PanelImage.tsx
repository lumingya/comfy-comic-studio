import { Group, Image as KImage, Rect } from 'react-konva';
import { assetUrl } from '../../api/client';
import type { Panel } from '../../api/types';
import { useImage } from '../board/MaskCanvas';
import { css, type RGB } from './backdrop';

type Box = [number, number, number, number];

/** Four gradient strips that dissolve a frameless panel into the track colour around it. */
function Fades(props: { w: number; h: number; top: RGB; bottom: RGB }) {
  const { w, h } = props;
  const f = Math.max(8, Math.min(w, h) / 10);
  const clear = (c: RGB) => `rgba(${c[0]},${c[1]},${c[2]},0)`;
  const strip = (x: number, y: number, sw: number, sh: number, dir: 'v' | 'h', c: RGB) => (
    <Rect
      x={x}
      y={y}
      width={sw}
      height={sh}
      listening={false}
      fillLinearGradientStartPoint={{ x: 0, y: 0 }}
      fillLinearGradientEndPoint={dir === 'v' ? { x: 0, y: sh } : { x: sw, y: 0 }}
      fillLinearGradientColorStops={[0, css(c), 1, clear(c)]}
    />
  );
  const mid = props.top.map((v, k) => Math.round((v + props.bottom[k]) / 2)) as RGB;
  return (
    <>
      {strip(0, 0, w, f, 'v', props.top)}
      <Rect
        x={0}
        y={h - f}
        width={w}
        height={f}
        listening={false}
        fillLinearGradientStartPoint={{ x: 0, y: f }}
        fillLinearGradientEndPoint={{ x: 0, y: 0 }}
        fillLinearGradientColorStops={[0, css(props.bottom), 1, clear(props.bottom)]}
      />
      {strip(0, 0, f, h, 'h', mid)}
      <Rect
        x={w - f}
        y={0}
        width={f}
        height={h}
        listening={false}
        fillLinearGradientStartPoint={{ x: f, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: 0 }}
        fillLinearGradientColorStops={[0, css(mid), 1, clear(mid)]}
      />
    </>
  );
}

export function PanelImage(props: {
  id: string;
  box: Box;
  panel: Panel | undefined;
  assetId: string | undefined;
  crop: Box | undefined;
  selected: boolean;
  edge: { top: RGB; bottom: RGB };
  onSelect: () => void;
  onChange: (box: Box) => void;
}) {
  const image = useImage(props.assetId ? assetUrl(props.assetId, 1200) : null);
  const [x0, y0, x1, y1] = props.box;
  const w = x1 - x0;
  const h = y1 - y0;
  const mode = props.panel?.width_mode ?? 'full';
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
      {mode === 'frameless' ? <Fades w={w} h={h} {...props.edge} /> : null}
      {mode === 'inset' ? <Rect width={w} height={h} stroke="#000" strokeWidth={3} /> : null}
      {props.selected ? (
        <Rect width={w} height={h} stroke="#3f7550" strokeWidth={4} dash={[10, 6]} />
      ) : null}
    </Group>
  );
}
