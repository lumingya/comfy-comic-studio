export type MaskShape =
  | { kind: 'box'; box: [number, number, number, number] }
  | { kind: 'lasso'; points: [number, number][] };

export function toMaskParams(shapes: MaskShape[]) {
  return {
    boxes: shapes.flatMap((s) => (s.kind === 'box' ? [s.box] : [])),
    polygons: shapes.flatMap((s) => (s.kind === 'lasso' ? [s.points] : [])),
  };
}
