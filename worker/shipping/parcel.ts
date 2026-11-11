/**
 * The parcel and its customs details, the same whichever vendor carries it.
 */
import { costOfBook } from '../../src/lib/pricing';
import type { Dims } from '../../src/lib/scales';

/** HTS 3926.40.0090: ornamental articles of plastics, other. A miniature book ornament is not a statuette. */
export const HS_TARIFF_CODE = '3926400090';
// Matches the CUSMA certification of origin on file with Chit Chats, word for word.
export const CUSTOMS_DESCRIPTION = 'Blank 3D printed miniature book (plastic)';

export interface Parcel {
  packageType: 'thick_envelope' | 'parcel';
  /** cm */
  size: [number, number, number];
  /** g */
  weight: number;
}

/** Grams of padding and mailer around the blanks. */
const PACKAGING_GRAMS = 25;

/**
 * The parcel for an order: the blanks laid flat in two stacks inside a padded mailer. A thick envelope
 * up to 2 cm deep, a small parcel beyond that. An estimate until measured against real packing.
 */
export function parcelFor(dims: Dims, quantity: number): Parcel {
  const grams = costOfBook(dims).grams * quantity + PACKAGING_GRAMS;
  const stacks = quantity > 1 ? 2 : 1;
  const depthCm = Math.max(1, Math.ceil(((Math.ceil(quantity / stacks) * dims.spine) / 10 + 0.5) * 10) / 10);
  const lengthCm = Math.max(15, Math.ceil(dims.height / 10 + 4));
  const widthCm = Math.max(10, Math.ceil((stacks * dims.width) / 10 + 4));
  return {
    packageType: depthCm <= 2 ? 'thick_envelope' : 'parcel',
    size: [lengthCm, widthCm, Math.round(depthCm * 10) / 10],
    weight: Math.ceil(grams),
  };
}

/** Grams of one blank, for customs line items. */
export const unitGrams = (dims: Dims) => Math.max(1, Math.ceil(costOfBook(dims).grams));

/** "3-9 estimated business days", "Estimated delivery in 2 business days" -> {min, max}. */
export function parseDays(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = text.match(/(\d+)\s*business day/);
  return single ? { min: Number(single[1]), max: Number(single[1]) } : null;
}
