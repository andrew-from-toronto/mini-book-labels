/**
 * Tracking from Chit Chats moves orders on by itself: a labeled order becomes shipped once Chit Chats has
 * the parcel (and the buyer gets their tracking email), then delivered when it arrives. Runs on a
 * schedule (wrangler.jsonc "triggers") and from admin's Refresh tracking.
 */
import { decodeOrder, describeOrder } from '../src/lib/orderCode';
import { chitChatsShipments, type ChitChatsEnv } from './chitchats';
import { mailMissing, sendMail, shippedEmail, type MailEnv } from './mail';

/** Chit Chats statuses once it has the parcel, short of delivery. */
const ON_ITS_WAY = new Set(['received', 'released', 'inducted', 'in_transit', 'resolved', 'exception']);

/** The order a Chit Chats shipment status puts an order in, or null to leave it. */
export function statusFromTracking(current: string, shipment: string): 'shipped' | 'delivered' | null {
  if (shipment === 'delivered') return current === 'delivered' ? null : 'delivered';
  if (ON_ITS_WAY.has(shipment) && current === 'labeled') return 'shipped';
  return null;
}

export interface TrackedOrder {
  session_id: string;
  chitchats_shipment_id: string;
  status: string;
  order_code: string;
  quantity: number;
  email: string | null;
  name: string | null;
  tracking_url: string | null;
  tracking_code: string | null;
  shipped_emailed_at: string | null;
}

export type TrackingEnv = ChitChatsEnv & MailEnv & { SITE_URL?: string };

/** Emails the buyer their tracking, once per order. */
export async function emailShipped(db: D1Database, env: MailEnv, row: Omit<TrackedOrder, 'chitchats_shipment_id' | 'status'>, site: string) {
  if (row.shipped_emailed_at || !row.email || mailMissing(env)) return;
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
        site,
      },
      env.MAIL_REPLY_TO || env.MAIL_FROM,
    ),
  );
  await db.prepare("UPDATE orders SET shipped_emailed_at = datetime('now') WHERE session_id = ?1").bind(row.session_id).run();
}

/**
 * Checks labeled and shipped orders with Chit Chats (all of them, or the one given), records what it
 * says and moves them on. A shipment Chit Chats can't find, or an email that fails, is left for the next
 * check.
 */
export async function refreshTracking(
  db: D1Database,
  env: TrackingEnv,
  only?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ checked: number; shipped: number; delivered: number; failed: number }> {
  const columns =
    'session_id, chitchats_shipment_id, status, order_code, quantity, email, name, tracking_url, tracking_code, shipped_emailed_at';
  const query = only
    ? db
        .prepare(`SELECT ${columns} FROM orders WHERE session_id = ?1 AND chitchats_shipment_id IS NOT NULL AND status IN ('labeled', 'shipped', 'delivered')`)
        .bind(only)
    : db.prepare(`SELECT ${columns} FROM orders WHERE status IN ('labeled', 'shipped') AND chitchats_shipment_id IS NOT NULL`);
  const { results } = await query.all<TrackedOrder>();
  const shipments = chitChatsShipments(env, fetcher);
  const site = env.SITE_URL?.trim() || 'https://minibookornaments.com';
  const counts = { checked: results.length, shipped: 0, delivered: 0, failed: 0 };
  for (const row of results) {
    try {
      const shipment = await shipments.get(row.chitchats_shipment_id);
      const next = statusFromTracking(row.status, shipment.status);
      await db
        .prepare(
          `UPDATE orders SET label_status = ?2, tracking_checked_at = datetime('now'),
             status = COALESCE(?3, status),
             shipped_at = CASE WHEN ?3 IS NOT NULL AND shipped_at IS NULL THEN datetime('now') ELSE shipped_at END,
             delivered_at = CASE WHEN ?3 = 'delivered' AND delivered_at IS NULL THEN datetime('now') ELSE delivered_at END,
             updated_at = datetime('now')
           WHERE session_id = ?1`,
        )
        .bind(row.session_id, shipment.status, next)
        .run();
      if (next === 'shipped') counts.shipped++;
      if (next === 'delivered') counts.delivered++;
      // The buyer hears once Chit Chats has it, even if it went straight to delivered between checks.
      if (next) await emailShipped(db, env, row, site);
    } catch (e) {
      counts.failed++;
      console.error('tracking check failed', row.session_id, e instanceof Error ? e.message : e);
    }
  }
  return counts;
}
