import type { WrapSpine } from './types';

/** Weakest luminance step (0 to 255) across a column that counts as a fold line. */
const MIN_EDGE = 3;
const ANALYSIS_WIDTH = 400;

/**
 * Finds the spine in back + spine + front artwork from row-major luminance values, by its fold
 * lines when it has them and by the gutters around its text when it does not.
 *
 * A spine edge is a brightness step running the full height of the image, so each column is scored
 * by the median horizontal gradient over its rows: titles and illustrations only touch some rows
 * and leave the median near zero. The spine is the strongest pair of such edges around the middle.
 */
export function detectSpine(lum: ArrayLike<number>, w: number, h: number): WrapSpine | null {
  return detectByEdges(lum, w, h) ?? detectByGutters(lum, w, h);
}

function detectByEdges(lum: ArrayLike<number>, w: number, h: number): WrapSpine | null {
  const score = new Float32Array(w);
  const column = new Float32Array(h);
  for (let x = 1; x < w - 1; x++) {
    for (let y = 0; y < h; y++) column[y] = lum[y * w + x + 1] - lum[y * w + x - 1];
    column.sort();
    score[x] = Math.abs(column[h >> 1]);
  }

  let best: { sum: number; l: number; r: number } | null = null;
  for (let l = Math.floor(w * 0.3); l < w / 2; l++) {
    if (score[l] < MIN_EDGE) continue;
    for (let r = Math.ceil(w / 2); r <= w * 0.7; r++) {
      if (score[r] < MIN_EDGE) continue;
      const width = (r - l) / w;
      const offCentre = Math.abs((l + r) / 2 - w / 2) / w;
      if (width < 0.02 || width > 0.3 || offCentre > 0.06) continue;
      const sum = score[l] + score[r];
      if (!best || sum > best.sum) best = { sum, l, r };
    }
  }
  return best && { left: (best.l + 0.5) / w, right: (best.r + 0.5) / w };
}

/** Typical thickness one page adds to a book, in mm (two pages per leaf of roughly 0.11 mm paper). */
const MM_PER_PAGE = 0.057;
/** Typical cover width of a novel, in mm. */
const COVER_WIDTH_MM = 135;

/**
 * Estimates where the spine sits in wrap artwork from the book's page count alone: a thicker book
 * has a wider spine relative to its covers. Within about a fifth of the measured width on the
 * artwork this was tuned against, so it is a fallback for when the image gives no clues.
 */
export function spineFromPages(pages: number): WrapSpine {
  const thickness = pages * MM_PER_PAGE;
  const half = thickness / (2 * COVER_WIDTH_MM + thickness) / 2;
  return { left: 0.5 - half, right: 0.5 + half };
}

/** Share of a column's pixels that may differ from its background for the column to count as empty. */
const QUIET = 0.03;
/** Share of differing pixels, averaged over a few columns, that counts as text or artwork. */
const CONTENT = 0.1;

/** For each column, the share of pixels that differ from the column's own background (its median). */
function columnActivity(lum: ArrayLike<number>, w: number, h: number): Float32Array {
  const activity = new Float32Array(w);
  const column = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) column[y] = lum[y * w + x];
    const background = column.slice().sort()[h >> 1];
    let busy = 0;
    for (let y = 0; y < h; y++) if (Math.abs(column[y] - background) > 25) busy++;
    activity[x] = busy / h;
  }
  return activity;
}

/**
 * Fallback for seamless artwork with no fold lines, where the spine is as wide as the book is thick.
 *
 * Designers leave an empty gutter between the spine's text and the cover next to it. Working outward
 * from the middle, the first place where spine content gives way to such a gutter marks the edge of
 * the spine. The two covers are the same width, so an edge found on one side mirrors to the other;
 * that matters because front-cover artwork often runs right up to the spine with no gutter at all.
 */
function detectByGutters(lum: ArrayLike<number>, w: number, h: number): WrapSpine | null {
  const activity = columnActivity(lum, w, h);
  const run = Math.max(3, Math.round(w * 0.012));
  const centre = w / 2;

  const mean = (from: number, to: number) => {
    let sum = 0;
    for (let x = from; x <= to; x++) sum += activity[x];
    return sum / (to - from + 1);
  };
  const gutterFrom = (x: number, step: 1 | -1) => {
    let n = 0;
    while (x >= 0 && x < w && activity[x] < QUIET) {
      n++;
      x += step;
    }
    return n;
  };

  let left: { edge: number; gutter: number } | null = null;
  for (let x = Math.floor(centre - w * 0.015); x >= w * 0.3 && !left; x--) {
    const gutter = gutterFrom(x - 1, -1);
    if (gutter >= run && mean(x, x + run - 1) > CONTENT) left = { edge: x, gutter };
  }
  let right: { edge: number; gutter: number } | null = null;
  for (let x = Math.ceil(centre + w * 0.015); x <= w * 0.7 && !right; x++) {
    const gutter = gutterFrom(x + 1, 1);
    if (gutter >= run && mean(x - run + 1, x) > CONTENT) right = { edge: x + 1, gutter };
  }
  if (!left && !right) return null;

  let l = left ? left.edge : w - right!.edge;
  let r = right ? right.edge : w - left!.edge;
  // The content found hugs the spine's text, so widen into the gutter for a natural margin.
  const gutter = Math.min(left?.gutter ?? Infinity, right?.gutter ?? Infinity);
  const pad = Math.min(Math.round((r - l) * 0.12), Math.floor(gutter / 2));
  l -= pad;
  r += pad;

  const width = (r - l) / w;
  return width >= 0.02 && width <= 0.3 ? { left: l / w, right: r / w } : null;
}

/** Null when no spine is found or the image's pixels are not readable (no CORS). */
export function detectImageSpine(img: HTMLImageElement): WrapSpine | null {
  const w = Math.min(ANALYSIS_WIDTH, img.naturalWidth);
  const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const lum = new Float32Array(w * h);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    return detectSpine(lum, w, h);
  } catch {
    return null;
  }
}
