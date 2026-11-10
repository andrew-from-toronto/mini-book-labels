import type { WrapSpine } from './types';

/** Weakest luminance step (0 to 255) across a column that counts as a fold line. */
const MIN_EDGE = 3;
const ANALYSIS_WIDTH = 400;

/**
 * Finds the spine in back + spine + front artwork from row-major luminance values.
 *
 * A spine edge is a brightness step running the full height of the image, so each column is scored
 * by the median horizontal gradient over its rows: titles and illustrations only touch some rows
 * and leave the median near zero. The spine is the strongest pair of such edges around the middle.
 */
export function detectSpine(lum: ArrayLike<number>, w: number, h: number): WrapSpine | null {
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
