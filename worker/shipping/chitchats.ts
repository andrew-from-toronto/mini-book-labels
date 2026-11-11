/**
 * Chit Chats (https://chitchats.com/docs/api/v1), a Canadian shipping service.
 *
 * Chit Chats has no quote-only call: rates come from a shipment created with postage_type "unknown",
 * deleted straight after, so nothing is bought. Buying creates a shipment and buys postage for it, which
 * Chit Chats finishes in the background, normally within 3 seconds.
 *
 * US and international parcels carry customs line items: description, value, tariff code, origin and
 * the manufacturer's address (SHIP_FROM_* variables, never the source). US rates include duties paid.
 *
 * Settings: CHITCHATS_API_KEY and CHITCHATS_CLIENT_ID; CHITCHATS_BASE_URL=https://staging.chitchats.com
 * for a staging account (its own key and client id).
 */
import { CUSTOMS_DESCRIPTION, HS_TARIFF_CODE, parcelFor, parseDays, unitGrams } from './parcel';
import { ShippingError, type Rate, type Shipment, type ShipmentRequest, type ShipmentState, type ShippingProvider } from './types';

export interface ChitChatsEnv {
  CHITCHATS_API_KEY?: string;
  CHITCHATS_CLIENT_ID?: string;
  CHITCHATS_BASE_URL?: string;
}

const LIVE = 'https://chitchats.com';
const STAGING = 'https://staging.chitchats.com';

/** Which Chit Chats this is. Anything but the two real addresses is refused, so a typo never sends elsewhere. */
export function chitChatsMode(env: ChitChatsEnv): 'live' | 'test' {
  const url = env.CHITCHATS_BASE_URL?.trim().replace(/\/$/, '') || LIVE;
  if (url === LIVE) return 'live';
  if (url === STAGING) return 'test';
  throw new ShippingError(`CHITCHATS_BASE_URL must be ${LIVE} or ${STAGING}.`);
}

/** A rate as Chit Chats returns it. */
export interface ChitChatsRate {
  postage_type: string;
  postage_description?: string | null;
  payment_amount: string;
  delivery_time_description?: string | null;
}

/** A shipment as Chit Chats returns it, as far as needed here. */
export interface ChitChatsShipment {
  id: string;
  /** unpaid, postage_requested, postage_purchase_failed, ready, received, in_transit, delivered, voided, ... */
  status: string;
  rates?: ChitChatsRate[];
  postage_type?: string | null;
  carrier_tracking_code?: string | null;
  tracking_url?: string | null;
  postage_label_pdf_url?: string | null;
  purchase_amount?: string | null;
}

/** The Chit Chats shipment body for a parcel. Separate from the call so it can be tested. */
export function shipmentBody({ to, dims, quantity, unitValue, shipFrom }: ShipmentRequest) {
  const parcel = parcelFor(dims, quantity);
  const domestic = to.country.toUpperCase() === 'CA';
  return {
    name: to.name,
    address_1: to.line1,
    ...(to.line2 ? { address_2: to.line2 } : {}),
    city: to.city,
    ...(to.state ? { province_code: to.state.toUpperCase() } : {}),
    ...(to.postalCode ? { postal_code: to.postalCode } : {}),
    country_code: to.country.toUpperCase(),
    value: ((unitValue * quantity) / 100).toFixed(2),
    value_currency: 'cad',
    package_type: parcel.packageType,
    size_unit: 'cm',
    size_x: parcel.size[0],
    size_y: parcel.size[1],
    size_z: parcel.size[2],
    weight_unit: 'g',
    weight: parcel.weight,
    package_contents: 'merchandise',
    postage_type: 'unknown',
    ship_date: 'today',
    ...(domestic
      ? { description: CUSTOMS_DESCRIPTION }
      : {
          line_items: [
            {
              quantity,
              description: CUSTOMS_DESCRIPTION,
              value_amount: (unitValue / 100).toFixed(2),
              currency_code: 'cad',
              hs_tariff_code: HS_TARIFF_CODE,
              origin_country: shipFrom.country,
              weight: unitGrams(dims),
              weight_unit: 'g',
              manufacturer_contact: shipFrom.name,
              manufacturer_street: shipFrom.street,
              ...(shipFrom.street2 ? { manufacturer_street_2: shipFrom.street2 } : {}),
              manufacturer_city: shipFrom.city,
              manufacturer_postal_code: shipFrom.postalCode,
              manufacturer_province_code: shipFrom.province,
              manufacturer_country_code: shipFrom.country,
            },
          ],
        }),
  };
}

const cents = (amount: string | null | undefined) => {
  const n = Math.round(Number(amount) * 100);
  return Number.isFinite(n) ? n : null;
};

/** Chit Chats rates in the common shape. */
export const toRates = (rates: ChitChatsRate[]): Rate[] =>
  rates
    .map((r) => ({
      provider: 'chitchats' as const,
      service: r.postage_type,
      name: r.postage_description ?? r.postage_type,
      amount: cents(r.payment_amount) ?? 0,
      days: parseDays(r.delivery_time_description),
    }))
    .filter((r) => r.amount > 0);

/** Chit Chats statuses in the common states. */
export function stateOf(status: string): ShipmentState {
  switch (status) {
    case 'unpaid':
    case 'pending':
      return 'unpaid';
    case 'postage_requested':
      return 'buying';
    case 'postage_purchase_failed':
      return 'failed';
    case 'ready':
      return 'label';
    case 'received':
    case 'released':
    case 'inducted':
    case 'in_transit':
    case 'resolved':
      return 'in_transit';
    case 'delivered':
      return 'delivered';
    case 'exception':
      return 'exception';
    case 'voided':
    case 'canceled':
    case 'refund_requested':
    case 'refund_approved':
    case 'refunded':
      return 'voided';
    default:
      return 'unpaid';
  }
}

/** A Chit Chats shipment in the common shape. */
export const toShipment = (s: ChitChatsShipment): Shipment => ({
  provider: 'chitchats',
  id: s.id,
  state: stateOf(s.status),
  status: s.status,
  service: s.postage_type && s.postage_type !== 'unknown' ? s.postage_type : null,
  cost: cents(s.purchase_amount),
  trackingCode: s.carrier_tracking_code ?? null,
  trackingUrl: s.tracking_url ?? null,
  labelUrl: s.postage_label_pdf_url ?? null,
});

/** The Chit Chats API calls, each returning the shipment as Chit Chats then reports it. */
export function chitChatsApi(env: ChitChatsEnv, fetcher: typeof fetch = fetch) {
  const base = `${chitChatsMode(env) === 'test' ? STAGING : LIVE}/api/v1/clients/${env.CHITCHATS_CLIENT_ID}`;
  const headers = { Authorization: env.CHITCHATS_API_KEY ?? '', 'Content-Type': 'application/json; charset=utf-8' };
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetcher(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ShippingError(`Chit Chats ${init.method ?? 'GET'} ${path}: ${res.status} ${detail.slice(0, 300)}`);
    }
    return res;
  }
  const read = async (res: Response) => ((await res.json()) as { shipment: ChitChatsShipment }).shipment;
  const get = async (id: string) => read(await call(`/shipments/${id}`));
  return {
    get,
    create: async (request: ShipmentRequest) =>
      read(await call('/shipments', { method: 'POST', body: JSON.stringify(shipmentBody(request)) })),
    remove: async (id: string) => {
      await call(`/shipments/${id}`, { method: 'DELETE' });
    },
    /** Requests postage, then waits while Chit Chats buys it, up to about 20 seconds. */
    async buy(id: string, postageType: string, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
      await call(`/shipments/${id}/buy`, { method: 'PATCH', body: JSON.stringify({ postage_type: postageType }) });
      let shipment = await get(id);
      for (let i = 0; i < 20 && shipment.status === 'postage_requested'; i++) {
        await wait(1000);
        shipment = await get(id);
      }
      return shipment;
    },
    async refund(id: string) {
      await call(`/shipments/${id}/refund`, { method: 'PATCH' });
      return get(id);
    },
  };
}

export const chitChats: ShippingProvider<ChitChatsEnv> = {
  id: 'chitchats',
  name: 'Chit Chats',
  configured: (env) => Boolean(env.CHITCHATS_API_KEY?.trim() && env.CHITCHATS_CLIENT_ID?.trim()),
  mode: chitChatsMode,

  async quote(request, env, fetcher = fetch) {
    const api = chitChatsApi(env, fetcher);
    const draft = await api.create(request);
    // The draft goes whether or not rates came back; a failed delete only leaves an unpaid draft.
    await api.remove(draft.id).catch(() => undefined);
    return toRates(draft.rates ?? []);
  },

  async buy(request, service, env, existing, fetcher = fetch) {
    const api = chitChatsApi(env, fetcher);
    // Reuse this order's unpaid shipment if there is one, so failed attempts don't leave drafts behind.
    const reusable = existing ? await api.get(existing).catch(() => null) : null;
    const shipment = reusable && stateOf(reusable.status) === 'unpaid' ? reusable : await api.create(request);
    return toShipment(await api.buy(shipment.id, service));
  },

  get: async (id, env, fetcher = fetch) => toShipment(await chitChatsApi(env, fetcher).get(id)),
  refund: async (id, env, fetcher = fetch) => toShipment(await chitChatsApi(env, fetcher).refund(id)),
};
