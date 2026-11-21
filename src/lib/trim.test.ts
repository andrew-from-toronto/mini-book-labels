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

  it('trims thick white bars above and below a coloured cover', () => {
    const white: Colour = [255, 255, 255];
    const crop = detectTrim(image([30, 60, 140], [{ rows: [0, 10], colour: white }, { rows: [H - 10, H], colour: white }]), W, H)!;
    expect(crop).toEqual({ top: 11 / H, bottom: 11 / H, left: 0, right: 0 });
  });

  it('trims thick white bars either side of a coloured cover', () => {
    const white: Colour = [248, 248, 246];
    const crop = detectTrim(image([30, 60, 140], [{ cols: [0, 12], colour: white }, { cols: [W - 15, W], colour: white }]), W, H)!;
    expect(crop).toEqual({ top: 0, bottom: 0, left: 13 / W, right: 16 / W });
  });

  it('keeps a thick white band on one edge only', () => {
    expect(detectTrim(image([30, 60, 140], [{ rows: [0, 10], colour: [255, 255, 255] }]), W, H)).toBeNull();
  });

  it('keeps thick bars that are not white', () => {
    const grey: Colour = [128, 128, 128];
    expect(detectTrim(image([30, 60, 140], [{ rows: [0, 10], colour: grey }, { rows: [H - 10, H], colour: grey }]), W, H)).toBeNull();
  });

  it('keeps white bars around a mostly white cover', () => {
    const white: Colour = [255, 255, 255];
    // Dark rules set the bars apart, so only the cover's own whiteness keeps them.
    const black: Colour = [0, 0, 0];
    const strips = [
      { rows: [0, 10] as [number, number], colour: white },
      { rows: [H - 10, H] as [number, number], colour: white },
      { rows: [10, 11] as [number, number], colour: black },
      { rows: [H - 11, H - 10] as [number, number], colour: black },
    ];
    expect(detectTrim(image(white, strips), W, H)).toBeNull();
    expect(detectTrim(image([30, 60, 140], strips), W, H)).toEqual({ top: 11 / H, bottom: 11 / H, left: 0, right: 0 });
  });
});
