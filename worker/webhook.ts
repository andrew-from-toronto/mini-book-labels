/**
 * POST /api/stripe/webhook: Stripe tells us when an order is paid. Orders are recorded here, never from
 * the thanks page, which a buyer may never reach. The signature is checked before anything is read.
 *
 * Handled: checkout.session.completed and checkout.session.async_payment_succeeded (recorded once the
 * session is paid; a delayed payment method can complete unpaid and succeed later), and
 * checkout.session.async_payment_failed. Writes are idempotent, so Stripe's retries do no harm.
 */
import Stripe from 'stripe';
import { decodeOrder } from '../src/lib/orderCode';
import { priceOrder } from '../src/lib/pricing';
import { json } from './cache';

export interface OrderRecord {
  session_id: string;
  order_code: string;
  quantity: number;
  amount_total: number;
  currency: string;
  email: string | null;
  name: string | null;
  shipping_address: string | null;
  payment_status: string;
  /** Stripe PaymentIntent id, for the link in admin and refunds. */
  payment_intent: string | null;
  livemode: number;
  /** Why the order needs checking before it's made, or null: the price or shipping doesn't add up. */
  flag: string | null;
  status: 'paid' | 'failed';
}

/**
 * Problems with a paid session that admin should see before making the order: the amount paid for the
 * books and packing isn't what this site charges for them, or there's no shipping address or shipping.
 * Our checkout prevents all of these; a flag means something went around it.
 */
export function sessionProblems(session: Stripe.Checkout.Session): string | null {
  const problems: string[] = [];
  const order = decodeOrder(session.metadata?.order_code ?? '');
  const quantity = Number(session.metadata?.quantity);
  let expected: number | null = null;
  try {
    expected = order ? priceOrder(order.dims, quantity).subtotal : null;
  } catch {
    expected = null;
  }
  if (expected === null) problems.push('the book or quantity is not one this site sells');
  else if (session.amount_subtotal !== expected) {
    problems.push(`paid ${session.amount_subtotal ?? 0} cents for books and packing, not ${expected}`);
  }
  if (!session.collected_information?.shipping_details?.address) problems.push('no shipping address');
  if (!session.shipping_cost?.amount_total) problems.push('no shipping charged');
  return problems.length ? problems.join('; ') : null;
}

/** The order row for a session, or null if it is not one of ours (only our checkout sets order_code). */
export function orderFromSession(session: Stripe.Checkout.Session, status: OrderRecord['status']): OrderRecord | null {
  const code = session.metadata?.order_code;
  if (!code) return null;
  const shipping = session.collected_information?.shipping_details;
  return {
    session_id: session.id,
    order_code: code,
    quantity: Number(session.metadata?.quantity ?? 1),
    amount_total: session.amount_total ?? 0,
    currency: session.currency ?? 'cad',
    email: session.customer_details?.email ?? null,
    name: shipping?.name ?? session.customer_details?.name ?? null,
    shipping_address: shipping?.address ? JSON.stringify(shipping.address) : null,
    payment_status: session.payment_status,
    payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
    livemode: session.livemode ? 1 : 0,
    flag: sessionProblems(session),
    status,
  };
}

/** Writes or updates an order. A repeat of the same event leaves it as it was. */
export async function saveOrder(db: D1Database, order: OrderRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (session_id, order_code, quantity, amount_total, currency, email, name, shipping_address, payment_status, status, payment_intent, livemode, flag)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT (session_id) DO UPDATE SET
         payment_status = excluded.payment_status,
         payment_intent = COALESCE(excluded.payment_intent, orders.payment_intent),
         livemode = excluded.livemode,
         flag = excluded.flag,
         -- An order admin has moved on keeps its status if Stripe repeats an event.
         status = CASE WHEN orders.status IN ('printing', 'packing', 'labeled', 'shipped', 'delivered', 'cancelled') THEN orders.status ELSE excluded.status END,
         updated_at = datetime('now')`,
    )
    .bind(
      order.session_id,
      order.order_code,
      order.quantity,
      order.amount_total,
      order.currency,
      order.email,
      order.name,
      order.shipping_address,
      order.payment_status,
      order.status,
      order.payment_intent,
      order.livemode,
      order.flag,
    )
    .run();
}

export interface WebhookEnv {
  STRIPE_WEBHOOK_SECRET: string;
  ORDERS: D1Database;
}

export async function handleWebhook(
  request: Request,
  env: WebhookEnv,
  stripe: Pick<Stripe, 'webhooks'>,
  /** After a paid order is saved: the order emails. A throw makes the webhook fail, so Stripe retries. */
  onPaid?: (order: OrderRecord, session: Stripe.Checkout.Session) => Promise<void>,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const signature = request.headers.get('Stripe-Signature');
  if (!signature) return json(400, { error: 'Missing signature.' });
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json(400, { error: 'Bad signature.' });
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      // Delayed payment methods complete unpaid; async_payment_succeeded follows when the money arrives.
      if (session.payment_status === 'unpaid') break;
      const order = orderFromSession(session, 'paid');
      if (!order) break;
      await saveOrder(env.ORDERS, order);
      try {
        await onPaid?.(order, session);
      } catch (e) {
        console.error('after-payment step failed; Stripe will retry', e instanceof Error ? e.message : e);
        return json(500, { error: 'Try again.' });
      }
      break;
    }
    case 'checkout.session.async_payment_failed': {
      const order = orderFromSession(event.data.object, 'failed');
      if (order) await saveOrder(env.ORDERS, order);
      break;
    }
  }
  return json(200, { received: true });
}
