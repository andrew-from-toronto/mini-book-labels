import type { BookMesh, PartName } from './bookModel';
import type { Dims } from './scales';

/**
 * Flat-shaded triangles for one part of the book, with the label mapped onto its outer face. Label
 * triangles come first (`labelCount` of them), then the rest, so a renderer can give each run its own
 * material.
 */
export interface PartGeometry {
  positions: Float32Array;
  normals: Float32Array;
  /** u across the label (back, spine, front, left to right), v up from the bottom edge. */
  uvs: Float32Array;
  labelCount: number;
}

/**
 * Where a point on an outer face sits on the label. The label reads back | spine | front from left to
 * right, and wraps image out with the spine on the left of the front cover, which puts the front cover
 * on the y = 0 side (see buildBookParts).
 */
export function labelUv(part: PartName, [x, y, z]: number[], { height: H, width: W, spine: S }: Dims): [number, number] {
  const total = 2 * W + S;
  const v = z / H;
  if (part === 'front') return [(W + S + x) / total, v];
  if (part === 'back') return [(W - x) / total, v];
  // Spine, seen from outside: the back cover's edge is on the left.
  return [(W + (S - y)) / total, v];
}

/** Which way a part's label face points: the front faces -y, the back +y, the spine -x. */
function isLabelFace(part: PartName, n: number[]): boolean {
  if (part === 'front') return n[1] < -0.5;
  if (part === 'back') return n[1] > 0.5;
  // The rounded spine's facets lean a little towards the covers, so this is looser.
  if (part === 'spine') return n[0] < -0.2;
  return false;
}

export function partGeometry(part: PartName, { positions, triangles }: BookMesh, dims: Dims): PartGeometry {
  const count = triangles.length / 3;
  const label: number[] = [];
  const other: number[] = [];
  const normalsOf: number[][] = [];
  for (let t = 0; t < count; t++) {
    const p = [0, 1, 2].map((k) => {
      const i = triangles[t * 3 + k] * 3;
      return [positions[i], positions[i + 1], positions[i + 2]];
    });
    const a = p[1].map((c, i) => c - p[0][i]);
    const b = p[2].map((c, i) => c - p[0][i]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    normalsOf[t] = n.map((c) => c / len);
    (isLabelFace(part, normalsOf[t]) ? label : other).push(t);
  }

  const order = [...label, ...other];
  const out = {
    positions: new Float32Array(order.length * 9),
    normals: new Float32Array(order.length * 9),
    uvs: new Float32Array(order.length * 6),
    labelCount: label.length,
  };
  order.forEach((t, slot) => {
    for (let k = 0; k < 3; k++) {
      const i = triangles[t * 3 + k] * 3;
      const point = [positions[i], positions[i + 1], positions[i + 2]];
      out.positions.set(point, slot * 9 + k * 3);
      out.normals.set(normalsOf[t], slot * 9 + k * 3);
      if (slot < label.length) out.uvs.set(labelUv(part, point, dims), slot * 6 + k * 2);
    }
  });
  return out;
}
