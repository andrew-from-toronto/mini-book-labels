import { describe, expect, it } from 'vitest';
import { CUSTOM_COLOUR_SURCHARGE, handlingPrice, priceOrder } from '../src/lib/pricing';
import { sessionParams } from './checkout';

const ORIGIN = 'https://minibookornaments.com';
const BLACK = 'v1-h300-w200-s50-flat-nohook-c-black';
const CUSTOM = 'v1-h300-w200-s50-flat-nohook-c-custom';

const params = (body: Parameters<typeof sessionParams>[0]) => {
  const built = sessionParams(body, ORIGIN);
  if ('error' in built) throw new Error(built.error);
  return built.params;
};

describe('sessionParams', () => {
  it('prices a stocked colour as blanks plus packing', () => {
    const p = params({ code: BLACK, quantity: 5 });
    expect(p.line_items).toHaveLength(2);
    expect(p.metadata).toEqual({ order_code: BLACK, quantity: '5' });
  });

  it('adds the surcharge and keeps the description for a custom colour', () => {
    const p = params({ code: CUSTOM, quantity: 5, customColour: { description: ' forest green ', hex: '#228B22' } });
    const extra = p.line_items![2];
    expect(extra.price_data?.unit_amount).toBe(CUSTOM_COLOUR_SURCHARGE);
    expect(p.metadata).toMatchObject({ custom_colour: 'forest green', custom_colour_hex: '#228b22' });
    const order = priceOrder({ height: 30, width: 20, spine: 5 }, 5, { customColour: true });
    expect(order.subtotal).toBe(order.books + handlingPrice() + CUSTOM_COLOUR_SURCHARGE);
  });

  it('needs a description for a custom colour, and drops a malformed hex', () => {
    expect(sessionParams({ code: CUSTOM, quantity: 1 }, ORIGIN)).toEqual({ error: 'Describe the colour you want.' });
    const p = params({ code: CUSTOM, quantity: 1, customColour: { description: 'teal', hex: 'javascript:' } });
    expect(p.metadata).not.toHaveProperty('custom_colour_hex');
  });

  it('refuses colours that are not offered', () => {
    expect(sessionParams({ code: 'v1-h300-w200-s50-flat-nohook-c-gold', quantity: 1 }, ORIGIN)).toEqual({
      error: 'That colour is not available.',
    });
  });
});
