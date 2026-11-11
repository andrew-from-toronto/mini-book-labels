/**
 * Shipping quotes from Chit Chats (https://chitchats.com/docs/api/v1). Chit Chats has no quote-only
 * call: rates come from a shipment created with postage_type "unknown", which is deleted straight after,
 * so nothing is bought. Labels are bought later, from admin, for paid orders.
 *
 * US and international parcels carry customs line items: description, value, tariff code, origin and
 * the manufacturer's address (SHIP_FROM_* variables, never the source). US rates include duties paid.
 */
import type { Dims } from '../src/lib/scales';
import { costOfBook } from '../src/lib/pricing';
import type { ShipFrom } from './shipFrom';

export interface ChitChatsEnv {
  CHITCHATS_API_KEY: string;
  CHITCHATS_CLIENT_ID: string;
  /** Optional: https://staging.chitchats.com for the sandbox. */
  CHITCHATS_BASE_URL?: string;
}

/** HTS 3926.40.0090: ornamental articles of plastics, other. A miniature book ornament is not a statuette. */
export const HS_TARIFF_CODE = '3926400090';
// Matches the CUSMA certification of origin on file with Chit Chats, word for word.
export const CUSTOMS_DESCRIPTION = '3D Printed Mini Book Ornament (plastic)';

export interface Destination {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  /** Two letters where the country has them (provinces, states). */
  state?: string | null;
  postalCode?: string | null;
  /** Two letters. */
  country: string;
}

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

export interface ShippingQuote {
  /** Chit Chats postage type, to buy the same service later. */
  service: string;
  label: string;
  /** Cents, CAD: what the buyer pays for shipping, duties included. */
  amount: number;
  days: { min: number; max: number } | null;
}

interface Rate {
  postage_type: string;
  postage_description?: string | null;
  payment_amount: string;
  delivery_time_description?: string | null;
}

/** "3-9 estimated business days", "Estimated delivery in 2 business days" -> {min, max}. */
export function parseDays(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = text.match(/(\d+)\s*business day/);
  return single ? { min: Number(single[1]), max: Number(single[1]) } : null;
}

/** A plain name for a Chit Chats service, as the buyer sees it. */
function serviceLabel(rate: Rate): string {
  const known: Record<string, string> = {
    chit_chats_slim: 'Standard',
    chit_chats_select: 'Express',
    chit_chats_canada_tracked: 'Tracked',
    chit_chats_international_tracked: 'Tracked',
    chit_chats_us_courier: 'Tracked',
    chit_chats_us_select: 'Tracked',
    chit_chats_us_edge: 'Express',
    chit_chats_us_connect: 'Express',
  };
  return known[rate.postage_type] ?? rate.postage_description ?? 'Standard';
}

/**
 * At most two choices: the cheapest, and the fastest if it arrives sooner. Fewer, clearer options than
 * the full list Chit Chats returns.
 */
export function chooseQuotes(rates: Rate[]): ShippingQuote[] {
  const quotes = rates
    .map((r) => ({
      service: r.postage_type,
      label: serviceLabel(r),
      amount: Math.round(Number(r.payment_amount) * 100),
      days: parseDays(r.delivery_time_description),
    }))
    .filter((q) => Number.isFinite(q.amount) && q.amount > 0)
    .sort((a, b) => a.amount - b.amount);
  if (!quotes.length) return [];
  const cheapest = quotes[0];
  const fastest = [...quotes]
    .filter((q) => q.days)
    .sort((a, b) => a.days!.max - b.days!.max || a.amount - b.amount)[0];
  const sooner = fastest && cheapest.days && fastest.days!.max < cheapest.days.max;
  if (!sooner) return [{ ...cheapest, label: 'Standard' }];
  return [
    { ...cheapest, label: 'Standard' },
    { ...fastest, label: 'Express' },
  ];
}

export interface QuoteRequest {
  to: Destination;
  dims: Dims;
  quantity: number;
  /** Cents, CAD: value of one blank, for customs. */
  unitValue: number;
  shipFrom: ShipFrom;
}

/** The Chit Chats shipment body for a quote. Separate from the call so it can be tested. */
export function shipmentBody({ to, dims, quantity, unitValue, shipFrom }: QuoteRequest) {
  const parcel = parcelFor(dims, quantity);
  const domestic = to.country.toUpperCase() === 'CA';
  return {
    name: to.name,
    address_1: to.line1,
    ...(to.line2 ? { address_2: to.line2 } : {}),
    city: to.city,
    ...(to.state ? { province_code: to.state.toUpperCase() } : {}),
    ...(to.postalCode ? { postal_code: to.postalCode } : {}),
    country_code: to.country.toUpperCase(),
    value: ((unitValue * quantity) / 100).toFixed(2),
    value_currency: 'cad',
    package_type: parcel.packageType,
    size_unit: 'cm',
    size_x: parcel.size[0],
    size_y: parcel.size[1],
    size_z: parcel.size[2],
    weight_unit: 'g',
    weight: parcel.weight,
    package_contents: 'merchandise',
    postage_type: 'unknown',
    ship_date: 'today',
    ...(domestic
      ? { description: CUSTOMS_DESCRIPTION }
      : {
          line_items: [
            {
              quantity,
              description: CUSTOMS_DESCRIPTION,
              value_amount: (unitValue / 100).toFixed(2),
              currency_code: 'cad',
              hs_tariff_code: HS_TARIFF_CODE,
              origin_country: shipFrom.country,
              weight: Math.max(1, Math.ceil(costOfBook(dims).grams)),
              weight_unit: 'g',
              manufacturer_contact: shipFrom.name,
              manufacturer_street: shipFrom.street,
              ...(shipFrom.street2 ? { manufacturer_street_2: shipFrom.street2 } : {}),
              manufacturer_city: shipFrom.city,
              manufacturer_postal_code: shipFrom.postalCode,
              manufacturer_province_code: shipFrom.province,
              manufacturer_country_code: shipFrom.country,
            },
          ],
        }),
  };
}

export class ShippingError extends Error {}

/** Live quotes for an order to an address. Creates a draft shipment, reads its rates, deletes it. */
export async function quoteShipping(request: QuoteRequest, env: ChitChatsEnv, fetcher: typeof fetch = fetch) {
  const base = `${env.CHITCHATS_BASE_URL ?? 'https://chitchats.com'}/api/v1/clients/${env.CHITCHATS_CLIENT_ID}`;
  const headers = { Authorization: env.CHITCHATS_API_KEY, 'Content-Type': 'application/json; charset=utf-8' };
  const created = await fetcher(`${base}/shipments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(shipmentBody(request)),
  });
  if (!created.ok) {
    const detail = await created.text().catch(() => '');
    throw new ShippingError(`Chit Chats could not quote this address (${created.status}): ${detail.slice(0, 200)}`);
  }
  const body = (await created.json()) as { shipment?: { id?: string; rates?: Rate[] } };
  const shipment = body.shipment;
  // Drafts are deleted whether or not rates came back; a failed delete only leaves an unpaid draft.
  if (shipment?.id) await fetcher(`${base}/shipments/${shipment.id}`, { method: 'DELETE', headers }).catch(() => undefined);
  return chooseQuotes(shipment?.rates ?? []);
}
