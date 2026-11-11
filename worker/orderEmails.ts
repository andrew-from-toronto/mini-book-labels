/**
 * Emails for a paid order: a confirmation to the buyer and a notice to the shop. Each is sent once; the
 * orders table records when, so a retried webhook only sends what has not gone yet.
 */
import type Stripe from 'stripe';
import { describeBlank } from './checkout';
import { buyerEmail, mailMissing, sellerEmail, sendMail, type MailEnv, type OrderDetails } from './mail';

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** The order as the emails describe it, from the paid session and its shipping rate. */
export async function orderDetails(
  session: Stripe.Checkout.Session,
  stripe: Pick<Stripe, 'shippingRates'>,
  site: string,
): Promise<OrderDetails | null> {
  const code = session.metadata?.order_code;
  const email = session.customer_details?.email;
  const shipping = session.collected_information?.shipping_details;
  if (!code || !email || !shipping) return null;
  const a = shipping.address;
  const address = [
    shipping.name,
    a.line1,
    a.line2,
    [a.city, a.state, a.postal_code].filter(Boolean).join(' '),
    a.country ? countryName(a.country) : null,
  ].filter((line): line is string => Boolean(line));

  let rate = session.shipping_cost?.shipping_rate ?? null;
  if (typeof rate === 'string') rate = await stripe.shippingRates.retrieve(rate).catch(() => null);

  return {
    code,
    quantity: Number(session.metadata?.quantity ?? 1),
    description: describeBlank(code) ?? code,
    name: shipping.name,
    email,
    address,
    subtotal: session.amount_subtotal ?? 0,
    shipping: session.shipping_cost?.amount_total ?? 0,
    total: session.amount_total ?? 0,
    delivery: rate?.display_name ?? null,
    service: rate?.metadata?.chitchats_service ?? null,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
    livemode: session.livemode,
    site,
  };
}

/** Sends whichever order emails have not gone yet. Throws if one fails, so Stripe retries the webhook. */
export async function emailOrder(
  db: D1Database,
  env: MailEnv,
  sessionId: string,
  details: OrderDetails,
  send: typeof sendMail = sendMail,
): Promise<void> {
  const missing = mailMissing(env);
  if (missing) {
    console.warn('order emails not sent: Mailgun settings missing', missing);
    return;
  }
  const row = await db
    .prepare('SELECT buyer_emailed_at, seller_emailed_at FROM orders WHERE session_id = ?1')
    .bind(sessionId)
    .first<{ buyer_emailed_at: string | null; seller_emailed_at: string | null }>();
  if (!row) return;
  const mails = [
    { column: 'buyer_emailed_at', done: row.buyer_emailed_at, mail: () => buyerEmail(details, env.MAIL_REPLY_TO || env.MAIL_FROM) },
    { column: 'seller_emailed_at', done: row.seller_emailed_at, mail: () => sellerEmail(details, env.ORDER_NOTIFY_TO!) },
  ] as const;
  for (const { column, done, mail } of mails) {
    if (done) continue;
    await send(env, mail());
    await db.prepare(`UPDATE orders SET ${column} = datetime('now') WHERE session_id = ?1`).bind(sessionId).run();
  }
}
