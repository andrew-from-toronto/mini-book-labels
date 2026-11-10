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
  const p = PAPER[s.paper];
  const fit = (space: number, size: number) => Math.max(0, Math.floor((space + s.gap) / (size + s.gap)));
  const cols = fit(p.w - 2 * s.margin, labelWidth(s));
  const rows = fit(p.h - 2 * s.margin - FOOTER, s.height);
  return { cols, rows, perPage: cols * rows };
}

export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}
