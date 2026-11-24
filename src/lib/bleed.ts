/**
 * Bleed: artwork carried past each label's cut line, so a cut that wanders shows more artwork, never a
 * white sliver. Built from the finished label's own edges, so it matches them exactly:
 *
 * - stretch: the outermost row of pixels repeated outwards (exact colour; streaks where the edge is busy)
 * - mirror: the outer band of the label reflected across the cut line (no seam, keeps texture)
 * - extend: mirror, then the real front cover artwork wherever the cover image has more than the front
 *   panel shows
 *
 * Every fill draws stretch first, so a bleed wider than a tiny label is still covered.
 */
import type { BleedFill } from './output';
import { drawFrontBleed, drawLabel, PRINT_PX_PER_MM, type LabelOptions } from './render';
import type { Book, LabelStyle, Settings } from './types';

/** Draw `src` rect into `dest` rect, flipped about the dest rect's own centre lines. */
export interface BleedOp {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  flipX: boolean;
  flipY: boolean;
  /** Nearest-pixel sampling, for stretched edges. */
  sharp: boolean;
}

const op = (s: [number, number, number, number], d: [number, number, number, number], flipX = false, flipY = false, sharp = false): BleedOp => ({
  sx: s[0],
  sy: s[1],
  sw: s[2],
  sh: s[3],
  dx: d[0],
  dy: d[1],
  dw: d[2],
  dh: d[3],
  flipX,
  flipY,
  sharp,
});

/** The draws that put a `w` × `h` label at (b, b) on a (w + 2b) × (h + 2b) canvas with its bleed filled. */
export function bleedOps(w: number, h: number, b: number, fill: BleedFill): BleedOp[] {
  const ops: BleedOp[] = [];
  if (b > 0) {
    ops.push(
      op([0, 0, 1, h], [0, b, b, h], false, false, true),
      op([w - 1, 0, 1, h], [b + w, b, b, h], false, false, true),
      op([0, 0, w, 1], [b, 0, w, b], false, false, true),
      op([0, h - 1, w, 1], [b, b + h, w, b], false, false, true),
      op([0, 0, 1, 1], [0, 0, b, b], false, false, true),
      op([w - 1, 0, 1, 1], [b + w, 0, b, b], false, false, true),
      op([0, h - 1, 1, 1], [0, b + h, b, b], false, false, true),
      op([w - 1, h - 1, 1, 1], [b + w, b + h, b, b], false, false, true),
    );
  }
  if (b > 0 && fill !== 'stretch') {
    const mx = Math.min(b, w);
    const my = Math.min(b, h);
    ops.push(
      op([0, 0, mx, h], [b - mx, b, mx, h], true),
      op([w - mx, 0, mx, h], [b + w, b, mx, h], true),
      op([0, 0, w, my], [b, b - my, w, my], false, true),
      op([0, h - my, w, my], [b, b + h, w, my], false, true),
      op([0, 0, mx, my], [b - mx, b - my, mx, my], true, true),
      op([w - mx, 0, mx, my], [b + w, b - my, mx, my], true, true),
      op([0, h - my, mx, my], [b - mx, b + h, mx, my], true, true),
      op([w - mx, h - my, mx, my], [b + w, b + h, mx, my], true, true),
    );
  }
  ops.push(op([0, 0, w, h], [b, b, w, h]));
  return ops;
}

export function applyBleedOps(ctx: CanvasRenderingContext2D, src: CanvasImageSource, ops: BleedOp[]) {
  for (const o of ops) {
    ctx.save();
    ctx.imageSmoothingEnabled = !o.sharp;
    ctx.translate(o.dx + (o.flipX ? o.dw : 0), o.dy + (o.flipY ? o.dh : 0));
    ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
    ctx.drawImage(src, o.sx, o.sy, o.sw, o.sh, 0, 0, o.dw, o.dh);
    ctx.restore();
  }
}

export interface BleedOptions {
  /** mm */
  bleed: number;
  fill: BleedFill;
}

/**
 * Draws a label onto `canvas` with its bleed: the canvas comes out `bleed` mm larger on every side, the
 * label's trim at (bleed, bleed).
 */
export function drawLabelWithBleed(
  canvas: HTMLCanvasElement,
  book: Book,
  cover: HTMLImageElement | null,
  dims: Pick<Settings, 'height' | 'width' | 'spine'>,
  style: LabelStyle,
  options: LabelOptions,
  bleed: BleedOptions,
) {
  const px = options.pxPerMm ?? PRINT_PX_PER_MM;
  const trim = document.createElement('canvas');
  drawLabel(trim, book, cover, dims, style, options);
  const b = Math.round(bleed.bleed * px);
  canvas.width = trim.width + 2 * b;
  canvas.height = trim.height + 2 * b;
  const ctx = canvas.getContext('2d')!;
  applyBleedOps(ctx, trim, bleedOps(trim.width, trim.height, b, bleed.fill));
  if (bleed.fill === 'extend' && cover && !options.wrapSpine && b > 0) {
    drawFrontBleed(ctx, cover, options.crop, Math.round(dims.width * px), Math.round(dims.spine * px), trim.height, b);
  }
  // Release the temporary canvas's pixels now rather than at the next collection.
  trim.width = trim.height = 0;
}
