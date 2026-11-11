/**
 * POST /api/stripe/webhook: Stripe tells us when an order is paid. Orders are recorded here, never from
 * the thanks page, which a buyer may never reach. The signature is checked before anything is read.
 *
 * Handled: checkout.session.completed and checkout.session.async_payment_succeeded (recorded once the
 * session is paid; a delayed payment method can complete unpaid and succeed later), and
 * checkout.session.async_payment_failed. Writes are idempotent, so Stripe's retries do no harm.
 */
import Stripe from 'stripe';
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
  status: 'paid' | 'failed';
}

/** The order row for a session, or null if it is not one of ours. */
export function orderFromSession(session: Stripe.Checkout.Session, status: OrderRecord['status']): OrderRecord | null {
  const code = session.metadata?.order_code ?? session.client_reference_id;
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
    status,
  };
}

/** Writes or updates an order. A repeat of the same event leaves it as it was. */
export async function saveOrder(db: D1Database, order: OrderRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (session_id, order_code, quantity, amount_total, currency, email, name, shipping_address, payment_status, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (session_id) DO UPDATE SET
         payment_status = excluded.payment_status,
         -- A shipped order stays shipped if Stripe repeats an event.
         status = CASE WHEN orders.status = 'shipped' THEN orders.status ELSE excluded.status END,
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
  onPaid?: (order: OrderRecord) => Promise<void>,
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
      await onPaid?.(order);
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
