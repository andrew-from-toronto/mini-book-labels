import { describe, expect, it } from 'vitest';
import { detectSpine } from './spine';

const W = 200;
const H = 60;

/** Flat covers at 120 with a darker spine band, plus bright "title" blocks covering a third of the rows. */
function artwork(spineFrom: number, spineTo: number, spineLum: number) {
  const lum = new Float32Array(W * H).fill(120);
  for (let y = 0; y < H; y++) {
    for (let x = spineFrom; x < spineTo; x++) lum[y * W + x] = spineLum;
    if (y % 3 === 0) for (let x = 130; x < 190; x += 4) lum[y * W + x] = 240;
  }
  return lum;
}

describe('detectSpine', () => {
  it('finds a spine band and ignores cover text', () => {
    const spine = detectSpine(artwork(90, 110, 100), W, H)!;
    expect(spine.left).toBeCloseTo(0.45, 1);
    expect(spine.right).toBeCloseTo(0.55, 1);
  });

  it('finds a spine that sits slightly off centre', () => {
    const spine = detectSpine(artwork(96, 112, 100), W, H)!;
    expect(spine.left).toBeCloseTo(0.48, 1);
    expect(spine.right).toBeCloseTo(0.56, 1);
  });

  it('returns null when the artwork has no visible spine edges', () => {
    expect(detectSpine(artwork(90, 110, 120), W, H)).toBeNull();
  });
});
