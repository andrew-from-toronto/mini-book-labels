import { describe, expect, it } from 'vitest';
import { bleedOps, type BleedOp } from './bleed';

/** Applies the ops to a grid of values, nearest-pixel, as a canvas would without smoothing. */
function apply(src: number[][], b: number, ops: BleedOp[]): number[][] {
  const h = src.length;
  const w = src[0].length;
  const out = Array.from({ length: h + 2 * b }, () => Array<number>(w + 2 * b).fill(-1));
  for (const o of ops) {
    for (let dy = 0; dy < o.dh; dy++) {
      for (let dx = 0; dx < o.dw; dx++) {
        // Position within the dest rect, flipped, then scaled back to the source rect.
        const fx = o.flipX ? o.dw - 1 - dx : dx;
        const fy = o.flipY ? o.dh - 1 - dy : dy;
        const sx = o.sx + Math.floor(((fx + 0.5) * o.sw) / o.dw);
        const sy = o.sy + Math.floor(((fy + 0.5) * o.sh) / o.dh);
        out[o.dy + dy][o.dx + dx] = src[sy][sx];
      }
    }
  }
  return out;
}

// A 4 × 3 label, each pixel numbered row * 10 + column.
const label = [
  [0, 1, 2, 3],
  [10, 11, 12, 13],
  [20, 21, 22, 23],
];

describe('bleed', () => {
  it('mirrors the label across its edges, corners included', () => {
    const out = apply(label, 2, bleedOps(4, 3, 2, 'mirror'));
    expect(out[2]).toEqual([1, 0, 0, 1, 2, 3, 3, 2]);
    expect(out[1]).toEqual([1, 0, 0, 1, 2, 3, 3, 2]);
    expect(out[0]).toEqual([11, 10, 10, 11, 12, 13, 13, 12]);
    expect(out[6]).toEqual([11, 10, 10, 11, 12, 13, 13, 12]);
  });

  it('repeats the edge pixels when stretched', () => {
    const out = apply(label, 2, bleedOps(4, 3, 2, 'stretch'));
    expect(out[0]).toEqual([0, 0, 0, 1, 2, 3, 3, 3]);
    expect(out[3]).toEqual([10, 10, 10, 11, 12, 13, 13, 13]);
    expect(out[6]).toEqual([20, 20, 20, 21, 22, 23, 23, 23]);
  });

  it('leaves no gap when the bleed is wider than the label', () => {
    const out = apply(label, 5, bleedOps(4, 3, 5, 'mirror'));
    expect(out.flat().every((v) => v >= 0)).toBe(true);
    // The label itself is untouched.
    expect(out.slice(5, 8).map((r) => r.slice(5, 9))).toEqual(label);
  });

  it('draws only the label with no bleed', () => {
    expect(bleedOps(4, 3, 0, 'mirror')).toHaveLength(1);
  });
});
