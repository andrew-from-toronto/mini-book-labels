import { CRICUT_AREA, cutterSettings, outputMode, sheetSize, shopGap, shopSettings } from './output';
import type { PaperKey, Settings, WrapSpine } from './types';

export const PAPER: Record<PaperKey, { w: number; h: number; label: string }> = {
  letter: { w: 215.9, h: 279.4, label: 'Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
};

/** Strip at the bottom of each page reserved for the calibration ruler, in mm. */
export const FOOTER = 6;

export const labelWidth = (s: Settings) => 2 * s.width + s.spine;

/** Assumes wrap artwork has the label's own proportions: the fallback when no spine is detected. */
export function defaultWrapSpine(s: Settings): WrapSpine {
  const half = s.spine / labelWidth(s) / 2;
  return { left: 0.5 - half, right: 0.5 + half };
}

export function gridFor(s: Settings) {
  const { cols, rows, perPage } = sheetLayout(s);
  return { cols, rows, perPage };
}

/** Bleed on each side of one label, mm: less than the full bleed where it touches a neighbour. */
export interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Slot {
  /** The label's trim (cut line), from the page's top left, mm. */
  x: number;
  y: number;
  bleed: Sides;
}

/**
 * Where labels go on a page, in mm from its top left. Home sheets start at the margin, with the ruler
 * along the bottom; print shop and cutter sheets centre the block of labels, each with its bleed.
 */
export interface SheetLayout {
  page: { w: number; h: number };
  /** Label size at trim, mm. */
  trimW: number;
  trimH: number;
  bleed: number;
  /** Space between neighbouring labels' trims, mm. */
  gap: number;
  cols: number;
  rows: number;
  perPage: number;
  slots: Slot[];
  /** The block of labels with their outer bleed, mm. */
  block: { x: number; y: number; w: number; h: number };
  /** Clear space round the page, mm. */
  margin: number;
  /** Home sheets: the calibration ruler sits in the bottom margin. */
  ruler: boolean;
}

/** How many of `size` fit in `space`, `gap` apart, with `extra` (outer bleed) round the run. */
const fit = (space: number, size: number, gap: number, extra: number) =>
  Math.max(0, Math.floor((space - extra + gap + 1e-9) / (size + gap)));

export function sheetLayout(s: Settings): SheetLayout {
  const trimW = labelWidth(s);
  const trimH = s.height;
  const mode = outputMode(s);
  let page: { w: number; h: number };
  let margin: number;
  let gap: number;
  let bleed = 0;
  let shared = false;
  if (mode === 'shop') {
    const shop = shopSettings(s);
    page = sheetSize(shop);
    margin = shop.margin;
    bleed = shop.bleed;
    gap = shopGap(shop);
    shared = gap === 0 && bleed > 0;
  } else if (mode === 'cricut') {
    // One printable area per page; Design Space places it on the paper and adds its marks round it.
    page = CRICUT_AREA;
    margin = 0;
    gap = cutterSettings(s).gap;
  } else if (mode === 'silhouette') {
    const c = cutterSettings(s);
    page = PAPER[s.paper];
    margin = c.margin;
    bleed = c.bleed;
    gap = Math.max(c.gap, 2 * bleed);
  } else {
    page = PAPER[s.paper];
    margin = s.margin;
    gap = s.gap;
  }

  if (mode === 'home') {
    const cols = fit(page.w - 2 * margin, trimW, gap, 0);
    const rows = fit(page.h - 2 * margin - FOOTER, trimH, gap, 0);
    const slots = grid(cols, rows, margin, margin, trimW, trimH, gap, () => ({ top: 0, right: 0, bottom: 0, left: 0 }));
    const w = cols * trimW + Math.max(0, cols - 1) * gap;
    const h = rows * trimH + Math.max(0, rows - 1) * gap;
    return { page, trimW, trimH, bleed, gap, cols, rows, perPage: cols * rows, slots, block: { x: margin, y: margin, w, h }, margin, ruler: true };
  }

  // Gaps hold each label's own bleed; shared cut lines leave bleed only round the outside of the block.
  const cols = fit(page.w - 2 * margin, trimW, gap, shared || gap > 0 ? 2 * bleed : 0);
  const rows = fit(page.h - 2 * margin, trimH, gap, shared || gap > 0 ? 2 * bleed : 0);
  const w = cols * trimW + Math.max(0, cols - 1) * gap + 2 * bleed;
  const h = rows * trimH + Math.max(0, rows - 1) * gap + 2 * bleed;
  const x0 = (page.w - w) / 2 + bleed;
  const y0 = (page.h - h) / 2 + bleed;
  const slots = grid(cols, rows, x0, y0, trimW, trimH, gap, (c, r) =>
    shared
      ? { top: r === 0 ? bleed : 0, right: c === cols - 1 ? bleed : 0, bottom: r === rows - 1 ? bleed : 0, left: c === 0 ? bleed : 0 }
      : { top: bleed, right: bleed, bottom: bleed, left: bleed },
  );
  return {
    page,
    trimW,
    trimH,
    bleed,
    gap,
    cols,
    rows,
    perPage: cols * rows,
    slots,
    block: { x: x0 - bleed, y: y0 - bleed, w, h },
    margin,
    ruler: false,
  };
}

function grid(
  cols: number,
  rows: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  gap: number,
  sides: (col: number, row: number) => Sides,
): Slot[] {
  const slots: Slot[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) slots.push({ x: x0 + c * (w + gap), y: y0 + r * (h + gap), bleed: sides(c, r) });
  }
  return slots;
}

/** The trim lines crop marks point along: each column's left and right edge, each row's top and bottom. */
export function trimLines(layout: SheetLayout, used: number): { xs: number[]; ys: number[] } {
  const slots = layout.slots.slice(0, used);
  const unique = (values: number[]) =>
    [...values].sort((a, b) => a - b).filter((v, i, all) => i === 0 || Math.abs(v - all[i - 1]) > 0.01);
  return {
    xs: unique(slots.flatMap((s) => [s.x, s.x + layout.trimW])),
    ys: unique(slots.flatMap((s) => [s.y, s.y + layout.trimH])),
  };
}

/** The bounding box of the first `used` labels with their bleed, mm. */
export function usedBlock(layout: SheetLayout, used: number) {
  const slots = layout.slots.slice(0, used);
  if (!slots.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...slots.map((s) => s.x - s.bleed.left));
  const y = Math.min(...slots.map((s) => s.y - s.bleed.top));
  const r = Math.max(...slots.map((s) => s.x + layout.trimW + s.bleed.right));
  const b = Math.max(...slots.map((s) => s.y + layout.trimH + s.bleed.bottom));
  return { x, y, w: r - x, h: b - y };
}

export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}
