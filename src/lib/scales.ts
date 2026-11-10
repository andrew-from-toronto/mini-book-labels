import type { Settings } from './types';

export type Dims = Pick<Settings, 'height' | 'width' | 'spine'>;

/** The real book the presets shrink: a typical trade paperback, in mm. */
const REAL: Dims = { height: 210, width: 140, spine: 35 };

export const SCALES: { ratio: number; note?: string }[] = [
  { ratio: 4 },
  { ratio: 5 },
  { ratio: 6, note: 'fashion doll' },
  { ratio: 7 },
  { ratio: 10 },
  { ratio: 12, note: 'dollhouse' },
  { ratio: 24, note: 'half scale' },
];

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

export const dimsAtScale = (ratio: number): Dims => ({
  height: round(REAL.height / ratio, 1),
  width: round(REAL.width / ratio, 1),
  spine: round(REAL.spine / ratio, 1),
});

/** The preset these dimensions correspond to, or null for a custom size. */
export function matchingScale(dims: Dims): number | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const hit = SCALES.find(({ ratio }) => {
    const d = dimsAtScale(ratio);
    return same(d.height, dims.height) && same(d.width, dims.width) && same(d.spine, dims.spine);
  });
  return hit?.ratio ?? null;
}

/** Sets one dimension and scales the other two by the same factor. */
export function resizeProportionally(dims: Dims, key: keyof Dims, value: number): Dims {
  const factor = value / dims[key];
  return {
    height: round(dims.height * factor, 2),
    width: round(dims.width * factor, 2),
    spine: round(dims.spine * factor, 2),
    [key]: value,
  };
}
