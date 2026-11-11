/**
 * Admin API, for fulfilling orders without leaving the site: /api/admin/...
 *
 *   GET  orders                 every order, newest first
 *   POST orders/{id}/shipment   a Chit Chats shipment for the order (reused while unpaid), with its rates
 *   POST orders/{id}/buy        buys the label: {postage_type}
 *   POST orders/{id}/refund     asks Chit Chats for the postage back
 *   POST orders/{id}/shipped    marks the order shipped and emails the buyer their tracking
 *
 * Every call needs Cloudflare Access (worker/access.ts); changes must also come from this site.
 */
import { decodeOrder, describeOrder } from '../src/lib/orderCode';
import { costOfBook } from '../src/lib/pricing';
import { adminUser, type AccessEnv } from './access';
import { json } from './cache';
import { chitChatsShipments, parseDays, ShippingError, type ChitChatsEnv, type Shipment } from './chitchats';
import { fromOwnSite } from './imageProxy';
import { mailMissing, sendMail, shippedEmail, type MailEnv } from './mail';
import { readShipFrom, type ShipFromEnv } from './shipFrom';

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
    return json(200, { orders: results.map(adminOrder) });
  }

  const match = path.match(/^orders\/([\w-]+)\/(shipment|buy|refund|shipped)$/);
  if (!match || request.method !== 'POST') return json(404, { error: 'Not found.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Admin changes start from this site.' });
  const [, id, action] = match;
  const row = await findOrder(db, id);
  if (!row) return json(404, { error: 'No such order.' });
  if (row.status !== 'paid' && row.status !== 'shipped') return json(409, { error: `This order is ${row.status}.` });
  const shipments = chitChatsShipments(env, fetcher);
  const reply = async (extra: Record<string, unknown> = {}) => json(200, { order: adminOrder((await findOrder(db, id))!), ...extra });

  try {
    switch (action) {
      case 'shipment': {
        // Reuse the order's shipment while it is unpaid, so rates can be looked at again without drafts piling up.
        let shipment = row.chitchats_shipment_id ? await shipments.get(row.chitchats_shipment_id) : null;
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
        const { postage_type } = ((await request.json().catch(() => ({}))) ?? {}) as { postage_type?: string };
        if (!row.chitchats_shipment_id) return json(409, { error: 'Get rates first.' });
        if (row.label_status === 'ready') return json(409, { error: 'This order already has a label.' });
        if (!postage_type) return json(400, { error: 'Choose a service.' });
        const shipment = await shipments.buy(row.chitchats_shipment_id, postage_type);
        await update(db, id, labelFields(shipment));
        if (shipment.status === 'postage_purchase_failed') return json(502, { error: 'Chit Chats could not buy that postage.' });
        return reply();
      }
      case 'refund': {
        if (!row.chitchats_shipment_id) return json(409, { error: 'No label to refund.' });
        if (row.status === 'shipped') return json(409, { error: 'This order has shipped.' });
        await update(db, id, labelFields(await shipments.refund(row.chitchats_shipment_id)));
        return reply();
      }
      case 'shipped': {
        if (!row.tracking_url && !row.tracking_code) return json(409, { error: 'Buy a label first.' });
        if (row.status !== 'shipped') await update(db, id, { status: 'shipped', shipped_at: new Date().toISOString() });
        // The email goes once, even if this is pressed again.
        if (!row.shipped_emailed_at && row.email && !mailMissing(env)) {
          const order = decodeOrder(row.order_code);
          await sendMail(
            env,
            shippedEmail(
              {
                name: row.name ?? '',
                email: row.email,
                quantity: row.quantity,
                description: order ? describeOrder(order) : row.order_code,
                trackingUrl: row.tracking_url,
                trackingCode: row.tracking_code,
                site: new URL(request.url).origin,
              },
              env.MAIL_REPLY_TO || env.MAIL_FROM,
            ),
          );
          await update(db, id, { shipped_emailed_at: new Date().toISOString() });
        }
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
