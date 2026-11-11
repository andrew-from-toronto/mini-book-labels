/**
 * Checkout for blank books, on our own page with Stripe Elements (ui_mode "elements").
 *
 * POST /api/checkout starts a Checkout Session. The browser sends only the order code (the book's size,
 * options and colour) and a quantity; the price is worked out here, with the same pricing the app shows
 * (src/lib/pricing.ts), so it cannot be changed on the way.
 *
 * POST /api/checkout/shipping takes the buyer's address, quotes it live with every shipping vendor set up
 * (worker/shipping) and sets the
 * address and shipping options on the session. Only the server may set shipping
 * (permissions.update_shipping_details = server_only), so the options always come from a real quote.
 *
 * Follows Stripe's guidance: no payment_method_types (Stripe shows the methods that suit each buyer),
 * fulfilment from the webhook rather than the thanks page, and an integration_identifier for the
 * Dashboard. No tax is collected (small supplier).
 */
import type Stripe from 'stripe';
import { cleanSource } from '../src/lib/attribution';
import { decodeOrder, describeOrder } from '../src/lib/orderCode';
import { costOfBook, handlingPrice, MAX_QUANTITY, priceOrder } from '../src/lib/pricing';
import { printable } from '../src/lib/shop';
import { json } from './cache';
import { fromOwnSite } from './imageProxy';
import { chooseQuotes, quoteAll, ShippingError, type ShippingEnv, type ShippingQuote } from './shipping';
import { readShipFrom, type ShipFromEnv } from './shipFrom';
import { SHIPPING_COUNTRIES } from './shipping/countries';

/** Tags these sessions in the Dashboard; Stripe asks for 8 random letters at the end. */
export const INTEGRATION_ID = 'mini-book-blanks-qhwzrtkd';

/** "30 x 20 x 5 mm, black, flat spine, hook centred, front": what the buyer sees for the line item. */
export function describeBlank(code: string): string | null {
  const order = decodeOrder(code);
  return order ? describeOrder(order) : null;
}

export interface CheckoutRequest {
  code: string;
  quantity: number;
  /** The campaign link that brought the buyer (src/lib/attribution.ts), if any. */
  source?: unknown;
}

/** The parameters for a session, or an error for the buyer. Separate from the API call so it can be tested. */
export function sessionParams(
  body: CheckoutRequest,
  origin: string,
): { params: Stripe.Checkout.SessionCreateParams } | { error: string } {
  const order = typeof body.code === 'string' ? decodeOrder(body.code) : null;
  if (!order) return { error: 'That is not a book this site makes.' };
  if (!printable(order.dims)) return { error: 'That size is not made to order.' };
  let price;
  try {
    price = priceOrder(order.dims, body.quantity);
  } catch {
    return { error: `Choose between 1 and ${MAX_QUANTITY} blanks.` };
  }
  const code = body.code.trim();
  return {
    params: {
      mode: 'payment',
      ui_mode: 'elements',
      permissions: { update_shipping_details: 'server_only' },
      line_items: [
        {
          quantity: price.quantity,
          price_data: {
            currency: 'cad',
            unit_amount: price.unitPrice,
            product_data: { name: 'Blank mini book', description: describeBlank(code) ?? undefined },
          },
        },
        {
          quantity: 1,
          price_data: { currency: 'cad', unit_amount: handlingPrice(), product_data: { name: 'Packing' } },
        },
      ],
      // Shipping options are added once the address is known (handleShipping).
      shipping_address_collection: { allowed_countries: [...SHIPPING_COUNTRIES] },
      client_reference_id: code,
      metadata: { order_code: code, quantity: String(price.quantity), ...cleanSource(body.source) },
      payment_intent_data: { metadata: { order_code: code } },
      // Where Stripe returns after payment, and after a bank's own confirmation page if one is needed.
      return_url: `${origin}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      integration_identifier: INTEGRATION_ID,
    },
  };
}

export async function handleCheckout(
  request: Request,
  stripe: Pick<Stripe, 'checkout'>,
  publishableKey: string,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Checkout starts from this site.' });
  let body: CheckoutRequest;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Send the order as JSON.' });
  }
  const built = sessionParams(body, new URL(request.url).origin);
  if ('error' in built) return json(400, { error: built.error });
  // Only the buyer's page knows this: shipping quotes for the session must present it, so a session id
  // seen elsewhere (logs, the dashboard) can't be used to change where an order ships.
  const quoteToken = crypto.randomUUID();
  built.params.metadata = { ...built.params.metadata, quote_token: quoteToken };
  try {
    const session = await stripe.checkout.sessions.create(built.params);
    return json(200, { clientSecret: session.client_secret, publishableKey, quoteToken });
  } catch (e) {
    console.error('checkout session failed', e instanceof Error ? e.message : e);
    return json(502, { error: 'Checkout is not available right now. Try again in a moment.' });
  }
}

/** The address Stripe's Address Element collects. */
export interface BuyerAddress {
  name: string;
  address: {
    line1: string;
    line2?: string | null;
    city: string;
    state?: string | null;
    postal_code?: string | null;
    country: string;
  };
}

export interface ShippingRequest {
  sessionId: string;
  shipping: BuyerAddress;
}

type Quotes = ShippingQuote[];

/** Stripe shipping options from the chosen quotes; the metadata says which vendor and service to buy. */
export function shippingOptions(quotes: Quotes): Stripe.Checkout.SessionUpdateParams.ShippingOption[] {
  return quotes.map((q) => ({
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: q.label,
      fixed_amount: { amount: q.amount, currency: 'cad' },
      metadata: { provider: q.provider, service: q.service },
      ...(q.days
        ? {
            delivery_estimate: {
              minimum: { unit: 'business_day', value: q.days.min },
              maximum: { unit: 'business_day', value: q.days.max },
            },
          }
        : {}),
    },
  }));
}

const CANT_SHIP = "We can't ship there yet.";

/** Quotes one checkout may ask for: plenty for a buyer fixing typos, too few to be worth abusing. */
export const MAX_QUOTES = 15;

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const optionalText = (v: unknown, max = 200): string | null | undefined =>
  v == null ? null : typeof v === 'string' && v.length <= max ? v.trim() || null : undefined;

export async function handleShipping(
  request: Request,
  stripe: Pick<Stripe, 'checkout'>,
  env: ShippingEnv & ShipFromEnv,
  quote: typeof quoteAll = quoteAll,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Checkout starts from this site.' });
  let body: ShippingRequest;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Send the address as JSON.' });
  }
  // Every field is checked for type and length: the address goes to the shipping vendor and to Stripe.
  const raw = (body?.shipping?.address ?? {}) as unknown as Record<string, unknown>;
  const a = {
    line1: text(raw.line1),
    line2: optionalText(raw.line2),
    city: text(raw.city, 100),
    state: optionalText(raw.state, 50),
    postal_code: optionalText(raw.postal_code, 20),
    country: text(raw.country, 2),
  };
  const sessionId = text(body?.sessionId, 300);
  const quoteToken = text((body as unknown as Record<string, unknown>)?.quoteToken, 100);
  if (!sessionId || !quoteToken || !a.line1 || !a.city || !a.country || a.line2 === undefined || a.state === undefined || a.postal_code === undefined) {
    return json(400, { error: 'Enter a full address.' });
  }
  if (!(SHIPPING_COUNTRIES as readonly string[]).includes(a.country.toUpperCase())) {
    return json(422, { error: CANT_SHIP });
  }
  const from = readShipFrom(env);
  if ('missing' in from) {
    console.error('ship-from address incomplete', from.missing);
    return json(500, { error: 'Shipping is not available right now.' });
  }

  // The order comes from our own session, never from the browser.
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return json(404, { error: 'That checkout has expired. Start again.' });
  }
  const code = session.metadata?.order_code;
  const order = code ? decodeOrder(code) : null;
  if (session.status !== 'open' || !order) {
    return json(409, { error: 'That checkout has finished or expired. Start again.' });
  }
  if (session.metadata?.quote_token !== quoteToken) return json(403, { error: 'Checkout starts from this site.' });
  const quotesSoFar = Number(session.metadata?.quotes ?? 0);
  if (quotesSoFar >= MAX_QUOTES) return json(429, { error: 'Too many address changes. Start the order again.' });
  const quantity = Number(session.metadata?.quantity ?? 1);
  const name = text(body.shipping?.name, 100) ?? 'Customer';

  let quotes: Quotes;
  try {
    const rates = await quote(
      {
        to: { name, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postal_code, country: a.country },
        dims: order.dims,
        quantity,
        unitValue: costOfBook(order.dims).unitPrice,
        shipFrom: from.address,
      },
      env,
    );
    quotes = chooseQuotes(rates);
  } catch (e) {
    console.error('shipping quote failed', e instanceof ShippingError || e instanceof Error ? e.message : e);
    return json(502, { error: "We couldn't get shipping prices for that address. Check it and try again." });
  }
  if (!quotes.length) return json(422, { error: CANT_SHIP });

  try {
    await stripe.checkout.sessions.update(sessionId, {
    metadata: { quotes: String(quotesSoFar + 1) },
    collected_information: {
      shipping_details: {
        name,
        address: {
          line1: a.line1,
          line2: a.line2 ?? undefined,
          city: a.city,
          state: a.state ?? undefined,
          postal_code: a.postal_code ?? undefined,
          country: a.country,
        },
      },
    },
    shipping_options: shippingOptions(quotes),
    });
  } catch (e) {
    console.error('shipping update failed', e instanceof Error ? e.message : e);
    return json(502, { error: "We couldn't save that address. Try again." });
  }
  return json(200, { options: quotes.length });
}
