/**
 * Admin API, for fulfilling orders without leaving the site: /api/admin/...
 *
 *   GET  orders                 every order, newest first
 *   POST orders/{id}/stage      moves an unshipped order to new, printing or packing: {stage}
 *   POST orders/{id}/shipment   a Chit Chats shipment for the order (reused while unpaid), with its rates
 *   POST orders/{id}/buy        buys the label: {postage_type}; the order becomes labeled
 *   POST orders/{id}/refund     voids a label Chit Chats hasn't received; the order goes back to packing
 *   POST orders/{id}/track      checks the order's tracking with Chit Chats
 *   POST tracking               checks every shipped order's tracking
 *
 * Every call needs Cloudflare Access (worker/access.ts); changes must also come from this site.
 */
import { decodeOrder, describeOrder } from '../src/lib/orderCode';
import { costOfBook } from '../src/lib/pricing';
import { adminUser, type AccessEnv } from './access';
import { json } from './cache';
import { chitChatsMode, chitChatsShipments, parseDays, ShippingError, type ChitChatsEnv, type Shipment } from './chitchats';
import { fromOwnSite } from './imageProxy';
import type { MailEnv } from './mail';
import { readShipFrom, type ShipFromEnv } from './shipFrom';
import { refreshTracking } from './tracking';

/**
 * An order moves new (paid) -> printing -> packing by hand, to labeled when its label is bought, then on
 * by itself with Chit Chats tracking: shipped once Chit Chats has the parcel, then delivered.
 */
export const MANUAL_STAGES = ['paid', 'printing', 'packing'] as const;
export const ORDER_STATUSES = [...MANUAL_STAGES, 'labeled', 'shipped', 'delivered'] as const;

export type AdminEnv = AccessEnv & ChitChatsEnv & ShipFromEnv & MailEnv & { ORDERS: D1Database };

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
  shipping_service: string | null;
  shipping_amount: number | null;
  chitchats_shipment_id: string | null;
  label_status: string | null;
  postage_type: string | null;
  postage_cost: string | null;
  tracking_code: string | null;
  tracking_url: string | null;
  label_pdf_url: string | null;
  label_png_url: string | null;
  shipped_at: string | null;
  shipped_emailed_at: string | null;
  tracking_checked_at: string | null;
  delivered_at: string | null;
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

/** A rate as admin lists it. */
export const adminRate = (r: NonNullable<Shipment['rates']>[number]) => ({
  postage_type: r.postage_type,
  description: r.postage_description ?? r.postage_type,
  amount: Math.round(Number(r.payment_amount) * 100),
  days: parseDays(r.delivery_time_description),
});

/** The shipment's label fields, for the orders row. */
const labelFields = (s: Shipment) => ({
  chitchats_shipment_id: s.id,
  label_status: s.status,
  postage_type: s.postage_type ?? null,
  postage_cost: s.purchase_amount ?? null,
  tracking_code: s.carrier_tracking_code ?? null,
  tracking_url: s.tracking_url ?? null,
  label_pdf_url: s.postage_label_pdf_url ?? null,
  label_png_url: s.postage_label_png_url ?? null,
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

export async function handleAdmin(request: Request, env: AdminEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!(await adminUser(request, env, fetcher))) return json(403, { error: 'Sign in to admin.' });
  const path = new URL(request.url).pathname.replace(/^\/api\/admin\/?/, '');
  const db = env.ORDERS;

  if (path === 'orders' && request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all<OrderRow>();
    let chitchats: string;
    try {
      chitchats = chitChatsMode(env);
    } catch (e) {
      chitchats = e instanceof Error ? e.message : 'misconfigured';
    }
    return json(200, { orders: results.map(adminOrder), chitchats });
  }

  if (path === 'tracking' && request.method === 'POST') {
    if (!fromOwnSite(request)) return json(403, { error: 'Admin changes start from this site.' });
    const result = await refreshTracking(db, env, undefined, fetcher);
    const { results } = await db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all<OrderRow>();
    return json(200, { orders: results.map(adminOrder), ...result });
  }

  const match = path.match(/^orders\/([\w-]+)\/(stage|shipment|buy|refund|track)$/);
  if (!match || request.method !== 'POST') return json(404, { error: 'Not found.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Admin changes start from this site.' });
  const [, id, action] = match;
  const row = await findOrder(db, id);
  if (!row) return json(404, { error: 'No such order.' });
  if (!(ORDER_STATUSES as readonly string[]).includes(row.status)) return json(409, { error: `This order is ${row.status}.` });
  const shipments = chitChatsShipments(env, fetcher);
  const reply = async (extra: Record<string, unknown> = {}) => json(200, { order: adminOrder((await findOrder(db, id))!), ...extra });
  const beforeShipping = (MANUAL_STAGES as readonly string[]).includes(row.status);

  try {
    switch (action) {
      case 'stage': {
        // New, printing and packing are set by hand; shipping is set by buying the label.
        const { stage } = ((await request.json().catch(() => ({}))) ?? {}) as { stage?: string };
        if (!stage || !(MANUAL_STAGES as readonly string[]).includes(stage)) return json(400, { error: 'Not a stage.' });
        if (!beforeShipping) return json(409, { error: 'This order has shipped.' });
        await update(db, id, { status: stage });
        return reply();
      }
      case 'shipment': {
        if (!beforeShipping) return json(409, { error: 'This order has shipped.' });
        // Reuse the order's shipment while it is unpaid, so rates can be looked at again without drafts piling up.
        // A shipment from the other Chit Chats (live or staging) is not found here: start a new one.
        let shipment = row.chitchats_shipment_id ? await shipments.get(row.chitchats_shipment_id).catch(() => null) : null;
        if (!shipment || shipment.status === 'voided' || shipment.status === 'canceled') {
          const order = decodeOrder(row.order_code);
          const address = row.shipping_address ? (JSON.parse(row.shipping_address) as Address) : null;
          const from = readShipFrom(env);
          if (!order || !address) return json(409, { error: 'This order has no book or address.' });
          if ('missing' in from) return json(500, { error: `Ship-from address incomplete: ${from.missing.join(', ')}` });
          shipment = await shipments.create({
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
          });
        }
        await update(db, id, labelFields(shipment));
        return reply({ rates: (shipment.rates ?? []).map(adminRate).sort((a, b) => a.amount - b.amount) });
      }
      case 'buy': {
        // Buying the label labels the order; tracking ships it, and emails the buyer, once Chit Chats has it.
        const { postage_type } = ((await request.json().catch(() => ({}))) ?? {}) as { postage_type?: string };
        if (!beforeShipping) return json(409, { error: 'This order already has a label.' });
        if (!row.chitchats_shipment_id) return json(409, { error: 'Get rates first.' });
        if (!postage_type) return json(400, { error: 'Choose a service.' });
        const shipment = await shipments.buy(row.chitchats_shipment_id, postage_type);
        await update(db, id, labelFields(shipment));
        if (shipment.status === 'postage_purchase_failed') return json(502, { error: 'Chit Chats could not buy that postage.' });
        if (shipment.status !== 'ready') return reply({ pending: true });
        await update(db, id, { status: 'labeled' });
        return reply();
      }
      case 'refund': {
        // Only before Chit Chats has the parcel: the order goes back to packing for a new label.
        if (!row.chitchats_shipment_id || row.status !== 'labeled') return json(409, { error: 'No label to void.' });
        await update(db, id, { ...labelFields(await shipments.refund(row.chitchats_shipment_id)), status: 'packing' });
        return reply();
      }
      case 'track': {
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
