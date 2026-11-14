export type Box = [number, number, number, number];
export interface ImageSize {
  width: number;
  height: number;
}
export interface Framing {
  zoom: number;
  x: number;
  y: number;
}
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function fit(size: ImageSize, box: Box) {
  const ratio = (box[2] - box[0]) / (box[3] - box[1]);
  const width = Math.min(size.width, size.height * ratio);
  return [width / size.width, width / ratio / size.height];
}

/** A crop at the panel's aspect ratio: zoom never stretches the artwork. */
export function cropFor(size: ImageSize, box: Box, framing: Framing): Box {
  const [baseW, baseH] = fit(size, box);
  const zoom = clamp(framing.zoom, 1, 8);
  const w = baseW / zoom;
  const h = baseH / zoom;
  const x = (1 - w) * clamp(framing.x, 0, 1);
  const y = (1 - h) * clamp(framing.y, 0, 1);
  return [x, y, x + w, y + h];
}

export function framingFor(size: ImageSize, box: Box, crop?: Box): Framing {
  if (!crop) return { zoom: 1, x: 0.5, y: 0.5 };
  const [baseW, baseH] = fit(size, box);
  const w = crop[2] - crop[0];
  const h = crop[3] - crop[1];
  return {
    zoom: clamp(Math.min(baseW / w, baseH / h), 1, 8),
    x: w < 1 ? clamp(crop[0] / (1 - w), 0, 1) : 0.5,
    y: h < 1 ? clamp(crop[1] / (1 - h), 0, 1) : 0.5,
  };
}
