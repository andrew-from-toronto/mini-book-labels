import type { Crop } from './types';

/** Per-channel standard deviation under which a line of pixels counts as one flat colour. */
const UNIFORM_STD = 10;
/** Largest channel difference for two lines to be the same border colour. */
const SAME = 20;
/** Smallest channel difference between the border and the artwork behind it. */
const STEP = 40;
/** Borders thicker than this share of the image are treated as part of the design. */
const MAX_THICKNESS = 0.03;
/** A border colour covering this much of the image is the cover's own colour, so nothing is trimmed. */
const COMMON = 0.35;
const ANALYSIS_WIDTH = 1200;

type Colour = [number, number, number];

const distance = (a: Colour, b: Colour) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * Finds thin stray borders: a flat-coloured strip along an edge (a white scan margin, a grey line)
 * that ends in a sharp step to the artwork. A strip in a colour the cover itself is largely made of
 * is left alone, so a white-edged white cover keeps its edges.
 */
export function detectTrim(rgba: ArrayLike<number>, w: number, h: number): Crop | null {
  if (w < 20 || h < 20) return null;

  const lineAt = (horizontal: boolean, index: number) => {
    const n = horizontal ? w : h;
    const sum = [0, 0, 0];
    const squares = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const p = 4 * (horizontal ? index * w + i : i * w + index);
      for (let c = 0; c < 3; c++) {
        sum[c] += rgba[p + c];
        squares[c] += rgba[p + c] ** 2;
      }
    }
    const mean = sum.map((s) => s / n) as Colour;
    return { mean, uniform: mean.every((m, c) => squares[c] / n - m * m < UNIFORM_STD ** 2) };
  };

  const commonness = (colour: Colour) => {
    let hits = 0;
    let total = 0;
    for (let p = 0; p < rgba.length; p += 16) {
      total++;
      if (distance([rgba[p], rgba[p + 1], rgba[p + 2]], colour) <= 30) hits++;
    }
    return hits / total;
  };

  const edge = (horizontal: boolean, fromEnd: boolean) => {
    const size = horizontal ? h : w;
    const at = (i: number) => lineAt(horizontal, fromEnd ? size - 1 - i : i);
    const max = Math.max(2, Math.ceil(size * MAX_THICKNESS));
    const border = at(0);
    if (!border.uniform) return 0;

    let n = 1;
    while (n <= max) {
      const line = at(n);
      if (!line.uniform || distance(line.mean, border.mean) >= SAME) break;
      n++;
    }
    if (n > max) return 0;

    // Image compression can leave one blended line between the border and the artwork.
    if (distance(at(n).mean, border.mean) <= STEP) {
      n++;
      if (distance(at(n).mean, border.mean) <= STEP) return 0;
    }
    if (commonness(border.mean) >= COMMON) return 0;
    // One more line clears compression fringing next to the border.
    return (n + 1) / size;
  };

  const crop = { top: edge(true, false), bottom: edge(true, true), left: edge(false, false), right: edge(false, true) };
  return crop.top || crop.bottom || crop.left || crop.right ? crop : null;
}

/** Null when there is nothing to trim or the image's pixels are not readable (no CORS). */
export function detectImageTrim(img: HTMLImageElement): Crop | null {
  // Close to full resolution: a stray line is often a single pixel and vanishes when downscaled.
  const w = Math.min(ANALYSIS_WIDTH, img.naturalWidth);
  const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    return detectTrim(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}
