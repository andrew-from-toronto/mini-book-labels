import { describe, expect, it } from 'vitest';
import { dimsAtScale } from '../../src/lib/scales';
import { HS_TARIFF_CODE } from './parcel';
import { shipmentFor, shipStation, toRates, toShipment, trackingState, type ShipStationRate } from './shipstation';

const shipFrom = { name: 'Maker', street: '1 Example St', street2: null, city: 'Toronto', province: 'ON', postalCode: 'M5V 1A1', country: 'CA', phone: '416-555-0100' };
const to = { name: 'Buyer', line1: '20 W 34th St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' };
const request = { to, dims: dimsAtScale(7), quantity: 5, unitValue: 175, shipFrom };
const env = { SHIPSTATION_API_KEY: 'TEST_abc' };
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const cad = (amount: number) => ({ currency: 'cad', amount });

describe('ShipStation', () => {
  it('is in test mode with a TEST_ key', () => {
    expect(shipStation.mode(env)).toBe('test');
    expect(shipStation.mode({ SHIPSTATION_API_KEY: 'live_key' })).toBe('live');
    expect(shipStation.configured({})).toBe(false);
  });

  it('sends customs only outside Canada, in grams and centimetres', () => {
    const us = shipmentFor(request) as Record<string, unknown> & { customs: { customs_items: Record<string, unknown>[] } };
    expect(us.customs.customs_items[0]).toMatchObject({ quantity: 5, value: 1.75, value_currency: 'cad', harmonized_tariff_code: HS_TARIFF_CODE, country_of_origin: 'CA' });
    expect((us.packages as { weight: { unit: string } }[])[0].weight.unit).toBe('gram');
    expect((us.ship_from as { phone: string }).phone).toBe('416-555-0100');
    expect((shipmentFor({ ...request, to: { ...to, country: 'CA', state: 'ON' } }) as Record<string, unknown>).customs).toBeUndefined();
  });

  it('adds up everything a rate costs, in CAD only, skipping rates with errors', () => {
    const rates: ShipStationRate[] = [
      { carrier_id: 'se-1', carrier_friendly_name: 'Canada Post', service_code: 'tracked_packet_usa', service_type: 'Tracked Packet USA', shipping_amount: cad(9.5), tax_amount: cad(1.24), delivery_days: 6 },
      { carrier_id: 'se-2', service_code: 'ground', shipping_amount: { currency: 'usd', amount: 7 } },
      { carrier_id: 'se-1', service_code: 'xpresspost_usa', shipping_amount: cad(20), error_messages: ['Too heavy'] },
    ];
    expect(toRates(rates)).toEqual([
      { provider: 'shipstation', service: 'se-1:tracked_packet_usa', name: 'Canada Post Tracked Packet USA', amount: 1074, days: { min: 6, max: 6 } },
    ]);
  });

  it('reads tracking codes as the common states', () => {
    expect(trackingState('AC')).toBe('in_transit');
    expect(trackingState('DE')).toBe('delivered');
    expect(trackingState('EX')).toBe('exception');
    expect(trackingState('NY')).toBeNull();
    const label = { label_id: 'L1', status: 'completed', carrier_id: 'se-1', service_code: 'tracked_packet_usa' };
    expect(toShipment(label).state).toBe('label');
    expect(toShipment(label, 'IT').state).toBe('in_transit');
    expect(toShipment({ ...label, status: 'voided' }).state).toBe('voided');
  });

  it('quotes every carrier on the account', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/v1/carriers')) return json({ carriers: [{ carrier_id: 'se-1' }, { carrier_id: 'se-2' }] });
      return json({ rate_response: { rates: [{ carrier_id: 'se-1', carrier_friendly_name: 'Canada Post', service_code: 'tp', service_type: 'Tracked Packet', shipping_amount: cad(8) }] } });
    }) as typeof fetch;
    const rates = await shipStation.quote(request, { SHIPSTATION_API_KEY: 'TEST_quote' }, fetcher);
    expect(rates).toEqual([{ provider: 'shipstation', service: 'se-1:tp', name: 'Canada Post Tracked Packet', amount: 800, days: null }]);
    expect(calls[1].url).toBe('https://api.shipengine.com/v1/rates');
    expect(calls[1].body?.rate_options).toEqual({ carrier_ids: ['se-1', 'se-2'], preferred_currency: 'cad' });
  });

  it('buys a 4x6 PDF label with the chosen carrier and service', async () => {
    let body: Record<string, unknown> = {};
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return json({
        label_id: 'se-L1',
        status: 'completed',
        carrier_id: 'se-1',
        service_code: 'tp',
        tracking_number: 'CP123',
        tracking_url: 'https://track',
        shipment_cost: cad(10.74),
        label_download: { pdf: 'https://label.pdf' },
      });
    }) as typeof fetch;
    const shipment = await shipStation.buy(request, 'se-1:tp', env, null, fetcher);
    expect(shipment).toMatchObject({ provider: 'shipstation', id: 'se-L1', state: 'label', cost: 1074, trackingCode: 'CP123', labelUrl: 'https://label.pdf' });
    expect(body).toMatchObject({ label_format: 'pdf', label_layout: '4x6', shipment: { carrier_id: 'se-1', service_code: 'tp' } });
  });

  it('needs a ship-from phone, and says why a void is refused', async () => {
    await expect(shipStation.buy({ ...request, shipFrom: { ...shipFrom, phone: null } }, 'se-1:tp', env)).rejects.toThrow(/SHIP_FROM_PHONE/);
    const fetcher = (async () => json({ approved: false, message: 'Outside the void window' })) as typeof fetch;
    await expect(shipStation.refund('se-L1', env, fetcher)).rejects.toThrow(/Outside the void window/);
  });

  it('reports its errors with their messages', async () => {
    const fetcher = (async () => json({ errors: [{ message: 'Access denied.' }] }, 401)) as typeof fetch;
    await expect(shipStation.quote(request, { SHIPSTATION_API_KEY: 'TEST_denied' }, fetcher)).rejects.toThrow(/401 Access denied/);
  });
});
