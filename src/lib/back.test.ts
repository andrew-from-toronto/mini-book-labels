import { describe, expect, it } from 'vitest';
import { DEFAULT_BACK_OPTIONS, flipScale, focusAt, resolveBack } from './back';

describe('back cover options', () => {
  it('fill in defaults, so settings saved before them draw as before', () => {
    expect(resolveBack('mirror', undefined)).toEqual({ ...DEFAULT_BACK_OPTIONS, barcode: true });
    expect(resolveBack('blurb', { blur: 0.9 }).blur).toBe(0.9);
  });

  it('have a barcode by default only on backs that would carry one', () => {
    expect(resolveBack('blurb', {}).barcode).toBe(true);
    expect(resolveBack('mirror', {}).barcode).toBe(true);
    expect(resolveBack('notes', {}).barcode).toBe(false);
    expect(resolveBack('plain', {}).barcode).toBe(false);
    // Once chosen, the choice holds whatever the back.
    expect(resolveBack('notes', { barcode: true }).barcode).toBe(true);
    expect(resolveBack('blurb', { barcode: false }).barcode).toBe(false);
  });

  it('keep sliders in range', () => {
    const r = resolveBack('mirror', { zoom: 9, blur: -1, darken: 2 });
    expect([r.zoom, r.blur, r.darken]).toEqual([3, 0, 0.6]);
  });

  it('turn the artwork as asked: mirrored, flipped, both at once, or neither', () => {
    expect(flipScale({ mirror: true, upsideDown: false })).toEqual([-1, 1]);
    expect(flipScale({ mirror: false, upsideDown: true })).toEqual([1, -1]);
    expect(flipScale({ mirror: true, upsideDown: true })).toEqual([-1, -1]);
    expect(flipScale({ mirror: false, upsideDown: false })).toEqual([1, 1]);
  });

  it('zoom in on the part asked for, or find it', () => {
    expect([focusAt('top'), focusAt('middle'), focusAt('bottom'), focusAt('auto')]).toEqual([0, 0.5, 1, null]);
  });
});
