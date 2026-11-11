/**
 * ShipStation API, formerly ShipEngine (https://docs.shipstation.com/apis/shipengine/openapi): many
 * carriers through one account. For a Canadian account that includes discounted Canada Post, FedEx,
 * GlobalPost and Purolator, plus any carrier accounts connected in its dashboard.
 *
 * Rates are quoted across every carrier on the account. A rate's service is "carrier_id:service_code",
 * so the same carrier and service can be bought later. Labels are 4x6 PDFs. Tracking comes from the
 * label's tracking log.
 *
 * Settings: SHIPSTATION_API_KEY (TEST_ keys use the sandbox: free, fake labels). Labels also need
 * SHIP_FROM_PHONE.
 */
import { CUSTOMS_DESCRIPTION, HS_TARIFF_CODE, parcelFor, unitGrams } from './parcel';
import { ShippingError, type Rate, type Shipment, type ShipmentRequest, type ShipmentState, type ShippingProvider } from './types';

export interface ShipStationEnv {
  SHIPSTATION_API_KEY?: string;
}

const BASE = 'https://api.shipengine.com';

interface Money {
  currency: string;
  amount: number;
}

/** A rate as ShipStation returns it. */
export interface ShipStationRate {
  carrier_id: string;
  carrier_friendly_name?: string | null;
  service_code: string;
  service_type?: string | null;
  shipping_amount: Money;
  insurance_amount?: Money | null;
  confirmation_amount?: Money | null;
  other_amount?: Money | null;
  tax_amount?: Money | null;
  delivery_days?: number | null;
  error_messages?: string[];
}

/** A label as ShipStation returns it. */
export interface ShipStationLabel {
  label_id: string;
  status: 'processing' | 'completed' | 'error' | 'voided' | string;
  carrier_id: string;
  service_code: string;
  tracking_number?: string | null;
  tracking_url?: string | null;
  tracking_status?: 'unknown' | 'in_transit' | 'error' | 'delivered' | string | null;
  voided?: boolean;
  shipment_cost?: Money | null;
  label_download?: { pdf?: string | null; href?: string | null } | null;
}

/** The shipment as ShipStation takes it: addresses, the parcel, and customs outside Canada. */
export function shipmentFor({ to, dims, quantity, unitValue, shipFrom }: ShipmentRequest) {
  const parcel = parcelFor(dims, quantity);
  const domestic = to.country.toUpperCase() === 'CA';
  return {
    ship_from: {
      name: shipFrom.name,
      phone: shipFrom.phone ?? '',
      address_line1: shipFrom.street,
      ...(shipFrom.street2 ? { address_line2: shipFrom.street2 } : {}),
      city_locality: shipFrom.city,
      state_province: shipFrom.province,
      postal_code: shipFrom.postalCode,
      country_code: shipFrom.country,
      address_residential_indicator: 'unknown',
    },
    ship_to: {
      name: to.name,
      address_line1: to.line1,
      ...(to.line2 ? { address_line2: to.line2 } : {}),
      city_locality: to.city,
      ...(to.state ? { state_province: to.state.toUpperCase() } : {}),
      ...(to.postalCode ? { postal_code: to.postalCode } : {}),
      country_code: to.country.toUpperCase(),
      address_residential_indicator: 'unknown',
    },
    packages: [
      {
        weight: { value: parcel.weight, unit: 'gram' },
        dimensions: { unit: 'centimeter', length: parcel.size[0], width: parcel.size[1], height: parcel.size[2] },
      },
    ],
    ...(domestic
      ? {}
      : {
          customs: {
            contents: 'merchandise',
            non_delivery: 'return_to_sender',
            customs_items: [
              {
                description: CUSTOMS_DESCRIPTION,
                quantity,
                value: Number((unitValue / 100).toFixed(2)),
                value_currency: 'cad',
                harmonized_tariff_code: HS_TARIFF_CODE,
                country_of_origin: shipFrom.country,
                weight: { value: unitGrams(dims), unit: 'gram' },
              },
            ],
          },
        }),
  };
}

const cents = (m: Money | null | undefined) => (m ? Math.round(m.amount * 100) : 0);

/** ShipStation rates in the common shape: CAD only, everything the label costs added up. */
export const toRates = (rates: ShipStationRate[]): Rate[] =>
  rates
    .filter((r) => !r.error_messages?.length && r.shipping_amount?.currency?.toLowerCase() === 'cad')
    .map((r) => ({
      provider: 'shipstation' as const,
      service: `${r.carrier_id}:${r.service_code}`,
      name: [r.carrier_friendly_name, r.service_type].filter(Boolean).join(' ') || r.service_code,
      amount: cents(r.shipping_amount) + cents(r.insurance_amount) + cents(r.confirmation_amount) + cents(r.other_amount) + cents(r.tax_amount),
      days: r.delivery_days ? { min: r.delivery_days, max: r.delivery_days } : null,
    }))
    .filter((r) => r.amount > 0);

/** Tracking log status codes in the common states. */
export function trackingState(code: string | null | undefined): ShipmentState | null {
  switch (code) {
    case 'AC': // accepted by the carrier
    case 'IT':
    case 'AT': // delivery attempted
      return 'in_transit';
    case 'DE':
    case 'SP': // delivered to a collection point
      return 'delivered';
    case 'EX':
      return 'exception';
    default:
      return null; // UN unknown, NY not yet in the system: still just a label
  }
}

/** A label in the common shape; `tracking` is the tracking log's status code when known. */
export function toShipment(label: ShipStationLabel, tracking?: string | null): Shipment {
  const state: ShipmentState =
    label.status === 'voided' || label.voided
      ? 'voided'
      : label.status === 'error'
        ? 'failed'
        : label.status === 'processing'
          ? 'buying'
          : (trackingState(tracking) ??
            (label.tracking_status === 'delivered' ? 'delivered' : label.tracking_status === 'in_transit' ? 'in_transit' : 'label'));
  return {
    provider: 'shipstation',
    id: label.label_id,
    state,
    status: tracking ?? label.status,
    service: `${label.carrier_id}:${label.service_code}`,
    cost: label.shipment_cost ? cents(label.shipment_cost) : null,
    trackingCode: label.tracking_number ?? null,
    trackingUrl: label.tracking_url ?? null,
    labelUrl: label.label_download?.pdf ?? label.label_download?.href ?? null,
  };
}

export function shipStationApi(env: ShipStationEnv, fetcher: typeof fetch = fetch) {
  const headers = { 'API-Key': env.SHIPSTATION_API_KEY ?? '', 'Content-Type': 'application/json' };
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetcher(`${BASE}${path}`, { ...init, headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let message = detail.slice(0, 300);
      try {
        const errors = (JSON.parse(detail) as { errors?: { message?: string }[] }).errors;
        if (errors?.length) message = errors.map((e) => e.message).join('; ');
      } catch {
        // Not JSON: keep the text.
      }
      throw new ShippingError(`ShipStation ${init.method ?? 'GET'} ${path}: ${res.status} ${message}`);
    }
    return (await res.json()) as T;
  }
  return {
    carriers: async () => (await call<{ carriers: { carrier_id: string }[] }>('/v1/carriers')).carriers.map((c) => c.carrier_id),
    rates: async (request: ShipmentRequest, carrierIds: string[]) =>
      (
        await call<{ rate_response: { rates?: ShipStationRate[] } }>('/v1/rates', {
          method: 'POST',
          body: JSON.stringify({ shipment: shipmentFor(request), rate_options: { carrier_ids: carrierIds, preferred_currency: 'cad' } }),
        })
      ).rate_response.rates ?? [],
    label: async (request: ShipmentRequest, carrierId: string, serviceCode: string) =>
      call<ShipStationLabel>('/v1/labels', {
        method: 'POST',
        body: JSON.stringify({
          shipment: { ...shipmentFor(request), carrier_id: carrierId, service_code: serviceCode },
          label_format: 'pdf',
          label_layout: '4x6',
          label_download_type: 'url',
        }),
      }),
    get: async (id: string) => call<ShipStationLabel>(`/v1/labels/${id}`),
    track: async (id: string) => call<{ status_code?: string }>(`/v1/labels/${id}/track`),
    void: async (id: string) => call<{ approved: boolean; message?: string }>(`/v1/labels/${id}/void`, { method: 'PUT' }),
  };
}

/** The account's carriers change rarely: kept for an hour per key. */
let carrierCache: { key: string; at: number; ids: string[] } | null = null;

async function carrierIds(env: ShipStationEnv, fetcher: typeof fetch): Promise<string[]> {
  const key = env.SHIPSTATION_API_KEY ?? '';
  if (carrierCache && carrierCache.key === key && Date.now() - carrierCache.at < 3_600_000) return carrierCache.ids;
  const ids = await shipStationApi(env, fetcher).carriers();
  carrierCache = { key, at: Date.now(), ids };
  return ids;
}

export const shipStation: ShippingProvider<ShipStationEnv> = {
  id: 'shipstation',
  name: 'ShipStation',
  configured: (env) => Boolean(env.SHIPSTATION_API_KEY?.trim()),
  mode: (env) => (env.SHIPSTATION_API_KEY?.trim().startsWith('TEST_') ? 'test' : 'live'),

  async quote(request, env, fetcher = fetch) {
    const ids = await carrierIds(env, fetcher);
    if (!ids.length) return [];
    return toRates(await shipStationApi(env, fetcher).rates(request, ids));
  },

  async buy(request, service, env, _existing, fetcher = fetch) {
    const [carrierId, serviceCode] = service.split(':');
    if (!carrierId || !serviceCode) throw new ShippingError(`Not a ShipStation service: ${service}`);
    if (!request.shipFrom.phone) throw new ShippingError('ShipStation labels need SHIP_FROM_PHONE.');
    return toShipment(await shipStationApi(env, fetcher).label(request, carrierId, serviceCode));
  },

  async get(id, env, fetcher = fetch) {
    const api = shipStationApi(env, fetcher);
    const label = await api.get(id);
    // The tracking log can lag or be missing for a fresh label: the label alone still says enough.
    const tracking = label.status === 'completed' ? await api.track(id).catch(() => null) : null;
    return toShipment(label, tracking?.status_code ?? null);
  },

  async refund(id, env, fetcher = fetch) {
    const api = shipStationApi(env, fetcher);
    const result = await api.void(id);
    if (!result.approved) throw new ShippingError(`ShipStation didn't void the label: ${result.message ?? 'no reason given'}`);
    return toShipment(await api.get(id));
  },
};
