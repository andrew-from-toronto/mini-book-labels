import { describe, expect, it } from 'vitest';
import { bandWithLeast, finishedText, gaussianish, starFills } from './render';

describe('the reading notes on the back', () => {
  it('says when the book was finished, by month', () => {
    expect(finishedText('2024-03-17')).toBe('Finished March 2024');
    expect(finishedText('2023-12-01')).toBe('Finished December 2023');
    expect(finishedText(null)).toBeNull();
    expect(finishedText('someday')).toBeNull();
  });

  it('fills stars for the rating, halves included', () => {
    expect(starFills(3.5)).toEqual([1, 1, 1, 0.5, 0]);
    expect(starFills(5)).toEqual([1, 1, 1, 1, 1]);
    expect(starFills(4.25)).toEqual([1, 1, 1, 1, 0.25]);
  });
});

describe('the mirrored back', () => {
  it('finds the stretch of the cover with the least lettering', () => {
    // Busy rows (a title) at the top, quiet ones (artwork) towards the bottom.
    const rows = [9, 9, 8, 9, 2, 1, 1, 2, 1, 3];
    expect(bandWithLeast(rows, 4)).toBeCloseTo(5 / 6);
    expect(bandWithLeast([1, 1, 1, 1, 9, 9, 9, 9], 4)).toBe(0);
    expect(bandWithLeast([1, 2, 3], 5)).toBe(0.5);
  });
});

describe('blurring without a canvas filter', () => {
  it('spreads a bright point smoothly, keeping its total brightness, with no blocks', () => {
    const w = 41;
    const h = 41;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const centre = 4 * (20 * w + 20);
    // A 7 x 7 white square centred on (20, 20), so rounding to bytes does not wash it out.
    for (let y = 17; y < 24; y++) for (let x = 17; x < 24; x++) data[4 * (y * w + x)] = 255;
    const before = data.reduce((sum, v, i) => (i % 4 === 0 ? sum + v : sum), 0);
    gaussianish(data, w, h, 4);
    const after = data.reduce((sum, v, i) => (i % 4 === 0 ? sum + v : sum), 0);
    expect(Math.abs(after - before) / before).toBeLessThan(0.03);
    // Falling off steadily from the middle in every direction, and the same each way.
    const row = Array.from({ length: 12 }, (_, i) => data[centre + 4 * i]);
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(data[centre + 4 * 6]).toBe(data[centre - 4 * 6]);
    expect(data[centre + 4 * 6 * w]).toBe(data[centre + 4 * 6]);
  });
});
