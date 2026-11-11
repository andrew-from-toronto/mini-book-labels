/**
 * Admin API, for fulfilling orders without leaving the site: /api/admin/...
 *
 *   GET  orders                 every order, newest first, and the shipping vendors set up
 *   POST orders/{id}/stage      moves an unshipped order to new, printing or packing: {stage}
 *   POST orders/{id}/rates      rates for the order's parcel from every shipping vendor set up
 *   POST orders/{id}/buy        buys the label: {provider, service}; the order becomes labeled
 *   POST orders/{id}/refund     voids a label the carrier hasn't received; the order goes back to packing
 *   POST orders/{id}/track      checks the order's label and tracking with its vendor
 *   POST orders/{id}/cancel     refunds the payment in full, voids any label not yet with the carrier,
 *                               marks the order cancelled and emails the buyer
 *   POST tracking               checks every labeled and shipped order's tracking
 *
 * Every call needs Cloudflare Access (worker/access.ts); changes must also come from this site.
 */
import { decodeOrder, describeOrder } from '../src/lib/orderCode';
import { costOfBook } from '../src/lib/pricing';
import { adminUser, type AccessEnv } from './access';
import { json } from './cache';
import { fromOwnSite } from './imageProxy';
import type Stripe from 'stripe';
import { cancelledEmail, mailMissing, sendMail, type MailEnv } from './mail';
import { readShipFrom, type ShipFromEnv } from './shipFrom';
import {
  configuredProviders,
  providerFor,
  quoteAll,
  ShippingError,
  type Shipment,
  type ShipmentRequest,
  type ShippingEnv,
} from './shipping';
import { refreshTracking } from './tracking';

/**
 * An order moves new (paid) -> printing -> packing by hand, to labeled when its label is bought, then on
 * by itself with the vendor's tracking: shipped once the carrier has the parcel, then delivered.
 */
export const MANUAL_STAGES = ['paid', 'printing', 'packing'] as const;
export const ORDER_STATUSES = [...MANUAL_STAGES, 'labeled', 'shipped', 'delivered', 'cancelled'] as const;

export type AdminEnv = AccessEnv & ShippingEnv & ShipFromEnv & MailEnv & { ORDERS: D1Database };

/** An orders row. */
export interface OrderRow {
  session_id: string;
  order_code: string;
  quantity: number;
  amount_total: number;
  currency: string;
  email: string | null;
  name: string | null;
  shipping_address: string | null;
  payment_status: string;
  status: string;
  created_at: string;
  delivery: string | null;
  shipping_provider: string | null;
  shipping_service: string | null;
  shipping_amount: number | null;
  shipment_provider: string | null;
  shipment_id: string | null;
  label_status: string | null;
  postage_type: string | null;
  label_cost: number | null;
  tracking_code: string | null;
  tracking_url: string | null;
  label_pdf_url: string | null;
  shipped_at: string | null;
  shipped_emailed_at: string | null;
  tracking_checked_at: string | null;
  delivered_at: string | null;
  payment_intent: string | null;
  livemode: number | null;
  refund_id: string | null;
  cancelled_at: string | null;
}

interface Address {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string;
}

/** What admin shows for an order. */
export function adminOrder(row: OrderRow) {
  const order = decodeOrder(row.order_code);
  return {
    ...row,
    address: row.shipping_address ? (JSON.parse(row.shipping_address) as Address) : null,
    description: order ? describeOrder(order) : row.order_code,
  };
}

/** The label fields of an orders row, from a vendor's shipment. */
const labelFields = (s: Shipment) => ({
  shipment_provider: s.provider,
  shipment_id: s.id,
  label_status: s.state,
  postage_type: s.service,
  label_cost: s.cost,
  tracking_code: s.trackingCode,
  tracking_url: s.trackingUrl,
  label_pdf_url: s.labelUrl,
});

async function update(db: D1Database, id: string, fields: Record<string, string | number | null>) {
  const names = Object.keys(fields);
  await db
    .prepare(`UPDATE orders SET ${names.map((n, i) => `${n} = ?${i + 2}`).join(', ')}, updated_at = datetime('now') WHERE session_id = ?1`)
    .bind(id, ...names.map((n) => fields[n]))
    .run();
}

const findOrder = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM orders WHERE session_id = ?1').bind(id).first<OrderRow>();

const allOrders = async (db: D1Database) =>
  (await db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all<OrderRow>()).results.map(adminOrder);

/** The parcel for an order, as every vendor takes it; or why there isn't one. */
function parcelRequest(row: OrderRow, env: ShipFromEnv): ShipmentRequest | string {
  const order = decodeOrder(row.order_code);
  const address = row.shipping_address ? (JSON.parse(row.shipping_address) as Address) : null;
  const from = readShipFrom(env);
  if (!order || !address) return 'This order has no book or address.';
  if ('missing' in from) return `Ship-from address incomplete: ${from.missing.join(', ')}`;
  return {
    to: {
      name: row.name ?? 'Customer',
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postal_code,
      country: address.country,
    },
    dims: order.dims,
    quantity: row.quantity,
    unitValue: costOfBook(order.dims).unitPrice,
    shipFrom: from.address,
  };
}

export async function handleAdmin(
  request: Request,
  env: AdminEnv,
  stripe: Pick<Stripe, 'refunds'>,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!(await adminUser(request, env, fetcher))) return json(403, { error: 'Sign in to admin.' });
  const path = new URL(request.url).pathname.replace(/^\/api\/admin\/?/, '');
  const db = env.ORDERS;

  if (path === 'orders' && request.method === 'GET') {
    return json(200, { orders: await allOrders(db), providers: configuredProviders(env) });
  }

  if (path === 'tracking' && request.method === 'POST') {
    if (!fromOwnSite(request)) return json(403, { error: 'Admin changes start from this site.' });
    const result = await refreshTracking(db, env, undefined, fetcher);
    return json(200, { orders: await allOrders(db), ...result });
  }

  const match = path.match(/^orders\/([\w-]+)\/(stage|rates|buy|refund|track|cancel)$/);
  if (!match || request.method !== 'POST') return json(404, { error: 'Not found.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Admin changes start from this site.' });
  const [, id, action] = match;
  const row = await findOrder(db, id);
  if (!row) return json(404, { error: 'No such order.' });
  if (!(ORDER_STATUSES as readonly string[]).includes(row.status)) return json(409, { error: `This order is ${row.status}.` });
  const reply = async (extra: Record<string, unknown> = {}) => json(200, { order: adminOrder((await findOrder(db, id))!), ...extra });
  const beforeShipping = (MANUAL_STAGES as readonly string[]).includes(row.status);
  const body = ((await request.json().catch(() => ({}))) ?? {}) as { stage?: string; provider?: string; service?: string };

  try {
    switch (action) {
      case 'stage': {
        // New, printing and packing are set by hand; labeled is set by buying the label.
        if (!body.stage || !(MANUAL_STAGES as readonly string[]).includes(body.stage)) return json(400, { error: 'Not a stage.' });
        if (!beforeShipping) return json(409, { error: 'This order has a label.' });
        await update(db, id, { status: body.stage });
        return reply();
      }
      case 'rates': {
        if (!beforeShipping) return json(409, { error: 'This order has a label.' });
        const parcel = parcelRequest(row, env);
        if (typeof parcel === 'string') return json(409, { error: parcel });
        return reply({ rates: await quoteAll(parcel, env, fetcher) });
      }
      case 'buy': {
        if (!beforeShipping) return json(409, { error: 'This order already has a label.' });
        if (!body.provider || !body.service) return json(400, { error: 'Choose a service.' });
        const provider = providerFor(body.provider);
        const parcel = parcelRequest(row, env);
        if (typeof parcel === 'string') return json(409, { error: parcel });
        // An unpaid shipment from an earlier attempt with the same vendor is reused.
        const existing = row.shipment_provider === provider.id ? row.shipment_id : null;
        const shipment = await provider.buy(parcel, body.service, env, existing, fetcher);
        await update(db, id, labelFields(shipment));
        if (shipment.state === 'failed') return json(502, { error: `${provider.name} could not buy that postage.` });
        // Still buying: Check again picks it up.
        if (shipment.state !== 'label') return reply({ pending: true });
        await update(db, id, { status: 'labeled' });
        return reply();
      }
      case 'refund': {
        // Only before the carrier has the parcel: the order goes back to packing for a new label.
        if (!row.shipment_id || !row.shipment_provider || row.status !== 'labeled') return json(409, { error: 'No label to void.' });
        const shipment = await providerFor(row.shipment_provider).refund(row.shipment_id, env, fetcher);
        await update(db, id, { ...labelFields(shipment), status: 'packing' });
        return reply();
      }
      case 'cancel': {
        if (row.status === 'cancelled') return json(409, { error: 'This order is already cancelled.' });
        if (!row.payment_intent) return json(409, { error: 'No Stripe payment on this order to refund.' });
        // A label the carrier hasn't got yet is voided too; a parcel already on its way can't be.
        if (row.status === 'labeled' && row.shipment_id && row.shipment_provider) {
          await update(db, id, labelFields(await providerFor(row.shipment_provider).refund(row.shipment_id, env, fetcher)));
        }
        // The idempotency key makes a repeated press (or retry) refund once.
        const refund = row.refund_id
          ? { id: row.refund_id, amount: row.amount_total }
          : await stripe.refunds.create(
              { payment_intent: row.payment_intent, reason: 'requested_by_customer', metadata: { order_code: row.order_code } },
              { idempotencyKey: `cancel-${id}` },
            );
        await update(db, id, { status: 'cancelled', refund_id: refund.id, cancelled_at: new Date().toISOString() });
        if (row.email && !mailMissing(env)) {
          const order = decodeOrder(row.order_code);
          await sendMail(
            env,
            cancelledEmail(
              {
                name: row.name ?? '',
                email: row.email,
                quantity: row.quantity,
                description: order ? describeOrder(order) : row.order_code,
                refunded: refund.amount ?? row.amount_total,
                site: new URL(request.url).origin,
              },
              env.MAIL_REPLY_TO || env.MAIL_FROM,
            ),
          ).catch((e) => console.error('cancellation email failed', e instanceof Error ? e.message : e));
        }
        return reply();
      }
      case 'track': {
        // A label still being bought: see whether it's ready.
        if (row.status === 'packing' && row.shipment_id && row.shipment_provider) {
          const shipment = await providerFor(row.shipment_provider).get(row.shipment_id, env, fetcher);
          await update(db, id, labelFields(shipment));
          if (shipment.state === 'label') await update(db, id, { status: 'labeled' });
          return reply();
        }
        await refreshTracking(db, env, id, fetcher);
        return reply();
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`admin ${action} failed`, message);
    return json(502, { error: e instanceof ShippingError ? message : `Failed: ${message}` });
  }
  return json(404, { error: 'Not found.' });
}
