import { describe, expect, it } from 'vitest';
import { gridFor, paginate, sheetLayout, trimLines, usedBlock } from './layout';
import { DEFAULT_SHOP } from './output';
import type { Settings } from './types';

const settings: Settings = { height: 30, width: 20, spine: 5, style: 'edge', paper: 'letter', margin: 10, gap: 2, guideOpacity: 1, guideWidth: 0.15, model: { hook: false, hookPosition: 'center', hookSide: 'front', roundSpine: false } };
const shop = (patch: Partial<typeof DEFAULT_SHOP> = {}): Settings => ({ ...settings, output: { mode: 'shop', shop: patch } });

describe('gridFor', () => {
  it('packs 45 x 30 mm labels onto Letter', () => {
    // width: (195.9 + 2) / 47 = 4.2; height: (279.4 - 20 - 6 + 2) / 32 = 7.98
    expect(gridFor(settings)).toEqual({ cols: 4, rows: 7, perPage: 28 });
  });

  it('reports zero when a label cannot fit', () => {
    expect(gridFor({ ...settings, width: 120 }).perPage).toBe(0);
  });
});

describe('home sheets', () => {
  it('start at the margin, with no bleed', () => {
    const l = sheetLayout(settings);
    expect(l.slots[0]).toEqual({ x: 10, y: 10, bleed: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(l.slots[1].x).toBe(10 + 45 + 2);
    expect(l.ruler).toBe(true);
  });
});

describe('print shop sheets', () => {
  it('space labels at least twice the bleed apart, each with its full bleed', () => {
    const l = sheetLayout(shop());
    expect(l.bleed).toBeCloseTo(3.175);
    expect(l.gap).toBeCloseTo(6.35);
    // (215.9 - 20 - 6.35 + 6.35) / 51.35 = 3.8: three across.
    expect(l.cols).toBe(3);
    expect(l.slots[0].bleed).toEqual({ top: l.bleed, right: l.bleed, bottom: l.bleed, left: l.bleed });
    expect(l.slots[1].x - l.slots[0].x).toBeCloseTo(45 + 6.35);
  });

  it('centre the block of labels on the sheet', () => {
    const l = sheetLayout(shop());
    expect(l.block.x).toBeCloseTo((l.page.w - l.block.w) / 2);
    expect(l.block.y).toBeCloseTo((l.page.h - l.block.h) / 2);
    expect(l.block.x).toBeGreaterThanOrEqual(l.margin);
  });

  it('with shared cut lines, butt labels together and keep bleed only round the outside', () => {
    const l = sheetLayout(shop({ spacing: 'shared' }));
    expect(l.gap).toBe(0);
    expect(l.cols).toBe(4);
    expect(l.slots[1].x - l.slots[0].x).toBeCloseTo(45);
    expect(l.slots[0].bleed).toEqual({ top: l.bleed, right: 0, bottom: 0, left: l.bleed });
    const last = l.slots[l.perPage - 1];
    expect(last.bleed).toEqual({ top: 0, right: l.bleed, bottom: l.bleed, left: 0 });
  });

  it('keep the shop minimum space even with shared cut lines asked for', () => {
    const l = sheetLayout(shop({ spacing: 'shared', minSpacing: 1.5, bleed: 0.5 }));
    expect(l.gap).toBe(1.5);
  });

  it('use the sheet the shop prints on', () => {
    expect(sheetLayout(shop({ sheet: 'sra3' })).page).toMatchObject({ w: 320, h: 450 });
    expect(sheetLayout(shop({ sheet: 'custom', sheetW: 100, sheetH: 150 })).page).toEqual({ w: 100, h: 150 });
  });

  it('lists each column and row edge once for crop marks', () => {
    const l = sheetLayout(shop({ spacing: 'shared' }));
    const { xs, ys } = trimLines(l, 6);
    expect(xs).toHaveLength(5);
    expect(ys).toHaveLength(3);
    const block = usedBlock(l, 6);
    expect(block.w).toBeCloseTo(4 * 45 + 2 * l.bleed);
  });
});

describe('cutting machine sheets', () => {
  it('fit Cricut batches in its print area, with no bleed of their own', () => {
    const l = sheetLayout({ ...settings, output: { mode: 'cricut' } });
    expect(l.page.w).toBeCloseTo(171.45);
    expect(l.bleed).toBe(0);
    expect(l.slots[1].x - l.slots[0].x).toBeCloseTo(45 + 4);
  });

  it('keep Silhouette labels inside the margin its registration marks need', () => {
    const l = sheetLayout({ ...settings, output: { mode: 'silhouette' } });
    expect(l.block.x).toBeGreaterThanOrEqual(20);
    expect(l.bleed).toBe(1.5);
  });
});

describe('paginate', () => {
  it('chunks items into pages', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no pages when nothing fits', () => {
    expect(paginate([1], 0)).toEqual([]);
  });
});
