import { describe, expect, it } from 'vitest';
import { gridFor, paginate } from './layout';
import type { Settings } from './types';

const settings: Settings = { height: 30, width: 20, spine: 5, style: 'edge', paper: 'letter', margin: 10, gap: 2, guideOpacity: 1, guideWidth: 0.15, model: { hook: false, hookPosition: 'center', roundSpine: false } };

describe('gridFor', () => {
  it('packs 45 x 30 mm labels onto Letter', () => {
    // width: (195.9 + 2) / 47 = 4.2; height: (279.4 - 20 - 6 + 2) / 32 = 7.98
    expect(gridFor(settings)).toEqual({ cols: 4, rows: 7, perPage: 28 });
  });

  it('reports zero when a label cannot fit', () => {
    expect(gridFor({ ...settings, width: 120 }).perPage).toBe(0);
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
