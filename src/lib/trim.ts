import type { Crop } from './types';

/** Per-channel standard deviation under which a line of pixels counts as one flat colour. */
const UNIFORM_STD = 10;
/** Largest channel difference for two lines to be the same border colour. */
const SAME = 20;
/** Smallest channel difference between the border and the artwork behind it. */
const STEP = 40;
/** Borders thicker than this share of the image are treated as part of the design, except paired white bars. */
const MAX_THICKNESS = 0.03;
/** A border colour covering this much of the image is the cover's own colour, so nothing is trimmed. */
const COMMON = 0.35;
/** White bars on both opposite edges, as when a cover was padded out to another shape, up to this share each. */
const MAX_BAR = 0.3;
/** Lowest channel value for a bar to count as white padding. */
const WHITE = 230;
const ANALYSIS_WIDTH = 1200;

type Colour = [number, number, number];

const distance = (a: Colour, b: Colour) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * Finds stray borders: a flat-coloured strip along an edge (a white scan margin, a grey line) that
 * ends in a sharp step to the artwork. Thin strips are trimmed on any edge. Thick white bars are
 * trimmed when they come in pairs, top and bottom or left and right, around a cover that is not
 * itself mostly white: that is a coloured cover padded out to another shape. A strip in a colour the
 * cover itself is largely made of is left alone, so a white-edged white cover keeps its edges.
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

  /** Share of the pixels in [x0, x1) x [y0, y1) close to `colour`, sampling every other row and column. */
  const commonness = (colour: Colour, x0 = 0, y0 = 0, x1 = w, y1 = h) => {
    let hits = 0;
    let total = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const p = 4 * (y * w + x);
        total++;
        if (distance([rgba[p], rgba[p + 1], rgba[p + 2]], colour) <= 30) hits++;
      }
    }
    return total ? hits / total : 1;
  };

  /** The flat strip along one edge, in lines to trim, if it ends in a sharp step within `maxShare`. */
  const strip = (horizontal: boolean, fromEnd: boolean, maxShare: number) => {
    const size = horizontal ? h : w;
    const at = (i: number) => lineAt(horizontal, fromEnd ? size - 1 - i : i);
    const max = Math.max(2, Math.ceil(size * maxShare));
    const border = at(0);
    if (!border.uniform) return null;

    let n = 1;
    while (n <= max) {
      const line = at(n);
      if (!line.uniform || distance(line.mean, border.mean) >= SAME) break;
      n++;
    }
    if (n > max) return null;

    // Image compression can leave one blended line between the border and the artwork.
    if (distance(at(n).mean, border.mean) <= STEP) {
      n++;
      if (distance(at(n).mean, border.mean) <= STEP) return null;
    }
    // One more line clears compression fringing next to the border.
    return { lines: n + 1, colour: border.mean };
  };

  const thin = (horizontal: boolean, fromEnd: boolean) => {
    const found = strip(horizontal, fromEnd, MAX_THICKNESS);
    return found && commonness(found.colour) < COMMON ? found.lines / (horizontal ? h : w) : 0;
  };

  /** White bars on both ends of an axis, judged against the artwork between them; null if not both. */
  const bars = (horizontal: boolean): [number, number] | null => {
    const start = strip(horizontal, false, MAX_BAR);
    const end = strip(horizontal, true, MAX_BAR);
    const white = (c: Colour) => c.every((v) => v >= WHITE);
    if (!start || !end || !white(start.colour) || !white(end.colour)) return null;
    const size = horizontal ? h : w;
    if (start.lines + end.lines >= size / 2) return null;
    const inner = horizontal
      ? commonness(start.colour, 0, start.lines, w, h - end.lines)
      : commonness(start.colour, start.lines, 0, w - end.lines, h);
    return inner < COMMON ? [start.lines / size, end.lines / size] : null;
  };

  const [top, bottom] = bars(true) ?? [thin(true, false), thin(true, true)];
  const [left, right] = bars(false) ?? [thin(false, false), thin(false, true)];
  const crop = { top, bottom, left, right };
  return top || bottom || left || right ? crop : null;
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
