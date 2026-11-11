/**
 * Printed blank books for sale: three price tiers by size, each a Stripe Payment Link. The shop stays
 * hidden in the app until every tier has a link, so this can ship before the Stripe side is set up.
 *
 * To set up in Stripe, for each tier: a price, then a Payment Link with adjustable quantity, shipping
 * address collection and shipping rates, redirecting after payment to https://minibookornaments.com/thanks/.
 * Paste the link URLs and the prices here.
 */
import type { Dims } from './scales';

export type TierName = 'small' | 'medium' | 'large';

export interface Tier {
  name: TierName;
  label: string;
  /** Tallest book in this tier, in mm. */
  maxHeight: number;
  /** Price shown in the app, as text: Stripe holds the real price. Empty until set. */
  price: string;
  /** The Stripe Payment Link URL. Empty until set. */
  link: string;
}

export const TIERS: Tier[] = [
  // 1:24 to 1:12 (8.8 to 17.5 mm tall).
  { name: 'small', label: 'Small', maxHeight: 18, price: '', link: '' },
  // 1:10 to 1:6 (21 to 35 mm).
  { name: 'medium', label: 'Medium', maxHeight: 36, price: '', link: '' },
  // 1:5 and 1:4 (42 and 52.5 mm), and custom sizes up to 60 mm.
  { name: 'large', label: 'Large', maxHeight: 60, price: '', link: '' },
];

/** The tier a book falls in, or null if it is too big to sell printed (it can still be downloaded). */
export function tierFor(dims: Dims, tiers: Tier[] = TIERS): Tier | null {
  return tiers.find((t) => dims.height <= t.maxHeight) ?? null;
}

/** The shop shows only once every tier has a price and a link. */
export const shopOpen = (tiers: Tier[] = TIERS) => tiers.every((t) => t.price && t.link);

/** A tier's Payment Link with the book's order code attached as Stripe's client_reference_id. */
export function checkoutUrl(tier: Tier, orderCode: string): string {
  const url = new URL(tier.link);
  url.searchParams.set('client_reference_id', orderCode);
  return url.toString();
}
