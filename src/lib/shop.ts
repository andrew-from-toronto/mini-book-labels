/**
 * Printed blank books for sale. Each is priced from its exact size (src/lib/pricing.ts) and paid for
 * through Stripe Checkout, which the Worker sets up. The shop stays hidden until checkout is ready;
 * add ?shop=preview to the address to see it before then.
 */
import type { Dims } from './scales';

/** Set to true once Stripe Checkout is live. */
export const SHOP_OPEN = false;

/** Sizes we print to order, by height in mm: from 1:24 up to a little past 1:4. */
export const PRINTABLE_HEIGHT = { min: 8, max: 60 };

export const printable = (dims: Dims) => dims.height >= PRINTABLE_HEIGHT.min && dims.height <= PRINTABLE_HEIGHT.max;

/** Whether to show the shop: open, or previewed with ?shop=preview. */
export function shopVisible(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return SHOP_OPEN || new URLSearchParams(search).get('shop') === 'preview';
}
