/**
 * Printed blank books for sale. Each is priced from its exact size (src/lib/pricing.ts) and paid for
 * through Stripe Checkout, which the Worker sets up. The shop stays hidden until checkout is ready;
 * add ?shop=preview to the address to see it before then.
 */
import type { Dims } from './scales';

/** Set to true once Stripe Checkout is live. */
export const SHOP_OPEN = true;

/** Sizes we print to order, by height in mm: from 1:24 up to a little past 1:4. */
export const PRINTABLE_HEIGHT = { min: 8, max: 60 };

/** Width and spine bounds, in mm, wide enough for any real book's proportions at those heights. */
export const PRINTABLE_WIDTH = { min: 4, max: 50 };
export const PRINTABLE_SPINE = { min: 1, max: 30 };

const within = (v: number, { min, max }: { min: number; max: number }) => v >= min && v <= max;

export const printable = (dims: Dims) =>
  within(dims.height, PRINTABLE_HEIGHT) &&
  within(dims.width, PRINTABLE_WIDTH) &&
  within(dims.spine, PRINTABLE_SPINE) &&
  dims.width <= dims.height;

/** Whether to show the shop: open, or previewed with ?shop=preview. */
// Shared with the Worker, which has no window: read the address only where there is one.
export function shopVisible(search: string = (globalThis as { location?: { search: string } }).location?.search ?? ''): boolean {
  return SHOP_OPEN || new URLSearchParams(search).get('shop') === 'preview';
}

/** The order page, opened in its own tab: the book as an order code, and how many. Keeps ?shop=preview. */
export function orderUrl(code: string, quantity = 5): string {
  const params = new URLSearchParams({ code, qty: String(quantity) });
  if (!SHOP_OPEN && shopVisible()) params.set('shop', 'preview');
  return `/order/?${params}`;
}
