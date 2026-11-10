import { describe, expect, it } from 'vitest';
import { detectTrim } from './trim';

const W = 100;
const H = 60;

type Colour = [number, number, number];

/** A flat cover with some contrasting "artwork" in the middle, then optional edge strips painted over it. */
function image(cover: Colour, strips: { rows?: [number, number]; cols?: [number, number]; colour: Colour }[]) {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  const paint = (x: number, y: number, [r, g, b]: Colour) => rgba.set([r, g, b], 4 * (y * W + x));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) paint(x, y, x > 30 && x < 70 && y > 15 && y < 45 ? [200, 160, 40] : cover);
  }
  for (const { rows, cols, colour } of strips) {
    for (let y = rows?.[0] ?? 0; y < (rows?.[1] ?? H); y++) {
      for (let x = cols?.[0] ?? 0; x < (cols?.[1] ?? W); x++) paint(x, y, colour);
    }
  }
  return rgba;
}

describe('detectTrim', () => {
  it('trims a one-pixel grey line under a dark cover', () => {
    const crop = detectTrim(image([8, 8, 10], [{ rows: [H - 1, H], colour: [182, 182, 183] }]), W, H)!;
    expect(crop).toEqual({ top: 0, bottom: 2 / H, left: 0, right: 0 });
  });

  it('trims a white margin on the left of a dark cover', () => {
    const crop = detectTrim(image([120, 20, 30], [{ cols: [0, 2], colour: [255, 255, 255] }]), W, H)!;
    expect(crop.left).toBe(3 / W);
    expect(crop.right).toBe(0);
  });

  it('leaves a white-edged cover alone when the cover is mostly white', () => {
    expect(detectTrim(image([250, 250, 250], [{ rows: [H - 1, H], colour: [255, 255, 255] }]), W, H)).toBeNull();
  });

  it('leaves a flat-coloured cover with no border alone', () => {
    expect(detectTrim(image([120, 20, 30], []), W, H)).toBeNull();
  });

  it('treats a thick band as part of the design', () => {
    expect(detectTrim(image([8, 8, 10], [{ rows: [H - 8, H], colour: [255, 255, 255] }]), W, H)).toBeNull();
  });
});
