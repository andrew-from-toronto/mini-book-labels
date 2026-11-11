import { describe, expect, it } from 'vitest';
import { decodeOrder, encodeOrder, type Order } from './orderCode';
import { dimsAtScale } from './scales';
import { checkoutUrl, shopOpen, tierFor, TIERS, type Tier } from './shop';

const order: Order = {
  dims: dimsAtScale(7),
  options: { hook: true, hookPosition: 'center', hookSide: 'front', roundSpine: false },
};

describe('order codes', () => {
  it('read like the book they describe', () => {
    expect(encodeOrder(order)).toBe('v1-h300-w200-s50-flat-hook-center-front');
    expect(
      encodeOrder({ dims: dimsAtScale(12), options: { ...order.options, hook: false, roundSpine: true } }),
    ).toBe('v1-h175-w117-s29-round-nohook');
  });

  it('round-trip every preset and hook placement', () => {
    for (const ratio of [4, 5, 6, 7, 10, 12, 24]) {
      for (const hookPosition of ['center', 'spine', 'fore-edge'] as const) {
        for (const hookSide of ['front', 'back'] as const) {
          const o: Order = { dims: dimsAtScale(ratio), options: { hook: true, hookPosition, hookSide, roundSpine: true } };
          expect(decodeOrder(encodeOrder(o))).toEqual(o);
        }
      }
    }
  });

  it('fit Stripe order references: letters, digits, dashes, at most 200 characters', () => {
    const code = encodeOrder({ dims: { height: 999.9, width: 999.9, spine: 999.9 }, options: { ...order.options, hookPosition: 'fore-edge', hookSide: 'back' } });
    expect(code).toMatch(/^[A-Za-z0-9_-]{1,200}$/);
  });

  it('reject anything else, tolerating surrounding spaces', () => {
    expect(decodeOrder('  v1-h300-w200-s50-flat-nohook ')).not.toBeNull();
    for (const bad of ['', 'hello', 'v2-h300-w200-s50-flat-nohook', 'v1-h0-w200-s50-flat-nohook', 'v1-h300-w200-s50-flat-hook-top-front']) {
      expect(decodeOrder(bad)).toBeNull();
    }
  });
});

describe('shop tiers', () => {
  it('sort each preset into a tier by height', () => {
    const tier = (ratio: number) => tierFor(dimsAtScale(ratio))?.name;
    expect([24, 12].map(tier)).toEqual(['small', 'small']);
    expect([10, 7, 6].map(tier)).toEqual(['medium', 'medium', 'medium']);
    expect([5, 4].map(tier)).toEqual(['large', 'large']);
    expect(tierFor({ height: 80, width: 50, spine: 10 })).toBeNull();
  });

  it('stay closed until every tier has a price and a link', () => {
    expect(shopOpen()).toBe(TIERS.every((t) => t.price && t.link));
    const ready: Tier[] = TIERS.map((t) => ({ ...t, price: '$5', link: 'https://buy.stripe.com/test_x' }));
    expect(shopOpen(ready)).toBe(true);
    expect(shopOpen([{ ...ready[0], link: '' }, ...ready.slice(1)])).toBe(false);
  });

  it('attach the order code to the Payment Link', () => {
    const tier: Tier = { ...TIERS[1], link: 'https://buy.stripe.com/test_abc123' };
    expect(checkoutUrl(tier, 'v1-h300-w200-s50-flat-nohook')).toBe(
      'https://buy.stripe.com/test_abc123?client_reference_id=v1-h300-w200-s50-flat-nohook',
    );
  });
});
