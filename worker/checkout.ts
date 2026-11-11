/**
 * POST /api/checkout: starts a Stripe Checkout Session for blank books. The browser sends only the order
 * code (the book's size and options) and a quantity; the price is worked out here, with the same pricing
 * the app shows (src/lib/pricing.ts), so it cannot be changed on the way.
 *
 * Follows Stripe's guidance: Checkout Sessions, no payment_method_types (Stripe shows the methods that
 * suit each buyer), fulfilment from the webhook rather than the success page, and an
 * integration_identifier to tell this flow apart in the Dashboard. No tax is collected (small supplier).
 */
import type Stripe from 'stripe';
import { decodeOrder } from '../src/lib/orderCode';
import { handlingPrice, priceOrder } from '../src/lib/pricing';
import { printable } from '../src/lib/shop';
import type { ModelOptions } from '../src/lib/types';
import { json } from './cache';
import { fromOwnSite } from './imageProxy';
import { SHIPPING_COUNTRIES, SHIPPING_OPTIONS } from './shipping';

/** Tags these sessions in the Dashboard; Stripe asks for 8 random letters at the end. */
export const INTEGRATION_ID = 'mini-book-blanks-qhwzrtkd';

/** "30 x 20 x 5 mm, flat spine, hook centred on the front": what the buyer sees for the line item. */
export function describeBlank(code: string): string | null {
  const order = decodeOrder(code);
  if (!order) return null;
  const { height, width, spine } = order.dims;
  const o: ModelOptions = order.options;
  const where = { center: 'centred', spine: 'at the spine corner', 'fore-edge': 'at the fore-edge corner' }[o.hookPosition];
  const hook = o.hook ? `hook ${where}, ${o.hookSide}` : 'no hook';
  return `${height} x ${width} x ${spine} mm, ${o.roundSpine ? 'rounded' : 'flat'} spine, ${hook}`;
}

export interface CheckoutRequest {
  code: string;
  quantity: number;
  /** Where Cancel at checkout returns to: a path on this site. */
  back?: string;
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
    return { error: 'Choose between 1 and 50 blanks.' };
  }
  const code = body.code.trim();
  const back = typeof body.back === 'string' && /^\/(?!\/)/.test(body.back) ? body.back : '/';
  return {
    params: {
      mode: 'payment',
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
      shipping_address_collection: { allowed_countries: [...SHIPPING_COUNTRIES] },
      shipping_options: SHIPPING_OPTIONS.map((s) => ({
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: s.label,
          fixed_amount: { amount: s.amount, currency: 'cad' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: s.days.min },
            maximum: { unit: 'business_day', value: s.days.max },
          },
        },
      })),
      client_reference_id: code,
      metadata: { order_code: code, quantity: String(price.quantity) },
      payment_intent_data: { metadata: { order_code: code } },
      success_url: `${origin}/thanks/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${back}`,
      integration_identifier: INTEGRATION_ID,
    },
  };
}

export async function handleCheckout(request: Request, stripe: Pick<Stripe, 'checkout'>): Promise<Response> {
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
  try {
    const session = await stripe.checkout.sessions.create(built.params);
    return json(200, { url: session.url });
  } catch (e) {
    console.error('checkout session failed', e instanceof Error ? e.message : e);
    return json(502, { error: 'Checkout is not available right now. Try again in a moment.' });
  }
}
