/**
 * POST /api/checkout/tip: "Buy me a coffee", paid on the site with the same Stripe form as orders. The buyer
 * picks the amount; it's checked here, in cents, CAD. Tips carry no order code, so the webhook never makes
 * them into orders; they show in the Stripe dashboard like any payment.
 */
import type Stripe from 'stripe';
import { json } from './cache';
import { fromOwnSite } from './imageProxy';

/** Cents, CAD. */
export const TIP_LIMITS = { min: 100, max: 20_000 };

/** The session for a tip, or an error for the buyer. Separate from the call so it can be tested. */
export function tipParams(amount: unknown, origin: string): { params: Stripe.Checkout.SessionCreateParams } | { error: string } {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < TIP_LIMITS.min || amount > TIP_LIMITS.max) {
    return { error: `Choose an amount from $${TIP_LIMITS.min / 100} to $${TIP_LIMITS.max / 100}.` };
  }
  return {
    params: {
      mode: 'payment',
      ui_mode: 'elements',
      // Payment finishes in the dialog; only a bank's own check sends the buyer away, and back here after.
      return_url: `${origin}/?coffee=thanks`,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: 'cad', unit_amount: amount, product_data: { name: 'A coffee for Mini Book Ornaments' } },
        },
      ],
      metadata: { kind: 'tip' },
      payment_intent_data: { metadata: { kind: 'tip' } },
    },
  };
}

export async function handleTip(request: Request, stripe: Pick<Stripe, 'checkout'>, publishableKey: string): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Tips start from this site.' });
  const body = (await request.json().catch(() => null)) as { amount?: unknown } | null;
  const built = tipParams(body?.amount, new URL(request.url).origin);
  if ('error' in built) return json(400, { error: built.error });
  try {
    const session = await stripe.checkout.sessions.create(built.params);
    return json(200, { clientSecret: session.client_secret, publishableKey });
  } catch (e) {
    console.error('tip session failed', e instanceof Error ? e.message : e);
    return json(502, { error: 'Payments are not available right now. Try again in a moment.' });
  }
}
