import { describe, expect, it } from 'vitest';
import { decodeOrder, encodeOrder, type Order } from './orderCode';
import { dimsAtScale } from './scales';
import { printable, SHOP_OPEN, shopVisible } from './shop';

const order: Order = {
  dims: dimsAtScale(7),
  options: { hook: true, hookPosition: 'center', hookSide: 'front', roundSpine: false },
  colour: 'white',
};

describe('order codes', () => {
  it('read like the book they describe', () => {
    expect(encodeOrder(order)).toBe('v1-h300-w200-s50-flat-hook-center-front-c-white');
    expect(
      encodeOrder({ dims: dimsAtScale(12), options: { ...order.options, hook: false, roundSpine: true }, colour: 'black' }),
    ).toBe('v1-h175-w117-s29-round-nohook-c-black');
  });

  it('round-trip every preset, hook placement and colour', () => {
    for (const ratio of [4, 5, 6, 7, 10, 12, 24]) {
      for (const hookPosition of ['center', 'spine', 'fore-edge'] as const) {
        for (const hookSide of ['front', 'back'] as const) {
          for (const colour of ['white', 'black']) {
            const o: Order = { dims: dimsAtScale(ratio), options: { hook: true, hookPosition, hookSide, roundSpine: true }, colour };
            expect(decodeOrder(encodeOrder(o))).toEqual(o);
          }
        }
      }
    }
  });

  it('carry a non-default hook hole, and leave the default out', () => {
    const big: Order = { ...order, options: { ...order.options, holeSize: 3 } };
    expect(encodeOrder(big)).toBe('v1-h300-w200-s50-flat-hook-center-front-o30-c-white');
    expect(decodeOrder(encodeOrder(big))).toEqual(big);
    expect(encodeOrder({ ...order, options: { ...order.options, holeSize: 1.6 } })).toBe(encodeOrder(order));
  });

  it('refuse hole sizes that are not offered', () => {
    expect(decodeOrder('v1-h300-w200-s50-flat-hook-center-front-o25-c-white')).toBeNull();
  });

  it('read codes from before colours as white', () => {
    expect(decodeOrder('v1-h300-w200-s50-flat-hook-center-front')).toEqual(order);
  });

  it('fit Stripe order references: letters, digits, dashes, at most 200 characters', () => {
    const code = encodeOrder({
      dims: { height: 999.9, width: 999.9, spine: 999.9 },
      options: { ...order.options, hookPosition: 'fore-edge', hookSide: 'back' },
      colour: 'translucentglowgreen',
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
  });

  it('reject anything else, tolerating surrounding spaces', () => {
    expect(decodeOrder('  v1-h300-w200-s50-flat-nohook ')).not.toBeNull();
    const bad = [
      '',
      'hello',
      'v2-h300-w200-s50-flat-nohook',
      'v1-h0-w200-s50-flat-nohook',
      'v1-h300-w200-s50-flat-hook-top-front',
      'v1-h300-w200-s50-flat-nohook-c-',
      'v1-h300-w200-s50-flat-nohook-c-Black!',
    ];
    for (const code of bad) expect(decodeOrder(code)).toBeNull();
  });
});

describe('shop', () => {
  it('prints sizes from 1:24 to a little past 1:4', () => {
    for (const ratio of [24, 12, 7, 4]) expect(printable(dimsAtScale(ratio))).toBe(true);
    expect(printable({ height: 80, width: 50, spine: 10 })).toBe(false);
    expect(printable({ height: 5, width: 3, spine: 1 })).toBe(false);
  });

  it('shows when open, and before then only when previewed', () => {
    expect(shopVisible('')).toBe(SHOP_OPEN);
    expect(shopVisible('?shop=preview')).toBe(true);
    expect(shopVisible('?shop=other')).toBe(SHOP_OPEN);
  });
});

describe('filament tones', () => {
  it('tell dark swatches from light ones', async () => {
    const { FILAMENTS, isDark } = await import('./filaments');
    expect(FILAMENTS.map((f) => [f.id, isDark(f.swatch)])).toEqual([
      ['white', false],
      ['black', true],
    ]);
  });
});
