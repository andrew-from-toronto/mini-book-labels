/**
 * Where blanks ship and what it costs, offered at checkout. PLACEHOLDER rates: replace with Canada Post's
 * price for a small padded envelope (and add US if shipping there).
 */
export const SHIPPING_COUNTRIES = ['CA'] as const;

export interface ShippingOption {
  label: string;
  /** Cents, CAD. */
  amount: number;
  /** Business days. */
  days: { min: number; max: number };
}

export const SHIPPING_OPTIONS: ShippingOption[] = [{ label: 'Canada Post, tracked', amount: 800, days: { min: 3, max: 8 } }];
