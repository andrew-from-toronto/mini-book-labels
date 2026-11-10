import { describe, expect, it } from 'vitest';
import { detectSpine, spineFromPages } from './spine';

const W = 200;
const H = 60;

/** Flat covers at 120 with a darker spine band, plus bright "title" blocks covering a third of the rows. */
function artwork(spineFrom: number, spineTo: number, spineLum: number) {
  const lum = new Float32Array(W * H).fill(120);
  for (let y = 0; y < H; y++) {
    for (let x = spineFrom; x < spineTo; x++) lum[y * W + x] = spineLum;
    if (y % 3 === 0) for (let x = 150; x < 190; x += 4) lum[y * W + x] = 240;
  }
  return lum;
}

describe('spineFromPages', () => {
  it('gives a centred spine that widens with page count', () => {
    const thin = spineFromPages(150);
    const thick = spineFromPages(450);
    expect((thin.left + thin.right) / 2).toBeCloseTo(0.5);
    // 450 pages is about 25.7 mm on 2 x 135 mm of cover: 8.7% of the artwork's width.
    expect(thick.right - thick.left).toBeCloseTo(0.087, 3);
    expect(thin.right - thin.left).toBeLessThan(thick.right - thick.left);
  });
});

describe('detectSpine', () => {
  it('finds a spine band and ignores cover text', () => {
    const spine = detectSpine(artwork(90, 110, 100), W, H)!;
    expect(spine.left).toBeCloseTo(0.45, 1);
    expect(spine.right).toBeCloseTo(0.55, 1);
  });

  it('prefers the centred spine over a stronger edge on the front cover', () => {
    const lum = artwork(90, 110, 100);
    for (let y = 0; y < H; y++) for (let x = 118; x < W; x++) lum[y * W + x] = 220;
    const spine = detectSpine(lum, W, H)!;
    expect(spine.left).toBeCloseTo(0.45, 1);
    expect(spine.right).toBeCloseTo(0.55, 2);
  });

  it('finds a spine that sits slightly off centre', () => {
    const spine = detectSpine(artwork(96, 112, 100), W, H)!;
    expect(spine.left).toBeCloseTo(0.48, 1);
    expect(spine.right).toBeCloseTo(0.56, 1);
  });

  it('finds a seamless spine from the gutter beside its text, mirroring the one edge it can see', () => {
    const lum = new Float32Array(W * H).fill(10);
    const text = (from: number, to: number) => {
      for (let y = 0; y < H; y += 2) for (let x = from; x < to; x++) lum[y * W + x] = 230;
    };
    text(20, 80); // back cover blurb, then a gutter from 80 to 90
    text(90, 110); // spine title
    text(110, 190); // front artwork running straight into the spine
    const spine = detectSpine(lum, W, H)!;
    // Content edge at 90 mirrors to 110; both widen by 12% of the width (2 columns) into the gutter.
    expect(spine.left).toBeCloseTo(88 / W, 5);
    expect(spine.right).toBeCloseTo(112 / W, 5);
  });

  it('returns null when the artwork has no visible spine edges', () => {
    expect(detectSpine(artwork(90, 110, 120), W, H)).toBeNull();
  });
});
