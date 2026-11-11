import { describe, expect, it, vi } from 'vitest';
import { dimsAtScale } from '../../src/lib/scales';
import { chitChats, chitChatsMode, shipmentBody, stateOf } from './chitchats';
import { chooseQuotes, configuredProviders, quoteAll, type Rate, type ShippingProvider } from './index';
import { HS_TARIFF_CODE, parcelFor, parseDays } from './parcel';

const shipFrom = { name: 'Maker', street: '1 Example St', street2: null, city: 'Toronto', province: 'ON', postalCode: 'M5V 1A1', country: 'CA' };
const to = { name: 'Buyer', line1: '20 W 34th St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' };
const request = { to, dims: dimsAtScale(7), quantity: 5, unitValue: 175, shipFrom };
const env = { CHITCHATS_API_KEY: 'k', CHITCHATS_CLIENT_ID: '1' };
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

describe('parcels', () => {
  it('reads delivery times', () => {
    expect(parseDays('3-9 estimated business days')).toEqual({ min: 3, max: 9 });
    expect(parseDays('Estimated delivery in 2 business days')).toEqual({ min: 2, max: 2 });
    expect(parseDays(null)).toBeNull();
  });

  it('packs small orders in a thick envelope and big ones in a parcel', () => {
    expect(parcelFor(dimsAtScale(7), 5).packageType).toBe('thick_envelope');
    expect(parcelFor(dimsAtScale(7), 20).packageType).toBe('parcel');
    expect(parcelFor(dimsAtScale(7), 5).weight).toBeGreaterThan(25);
  });
});

describe('choosing what checkout offers', () => {
  const rate = (provider: string, service: string, amount: number, min: number, max: number): Rate =>
    ({ provider, service, name: service, amount, days: { min, max } }) as Rate;

  it('offers the cheapest from any vendor, plus a faster one only when it is sooner', () => {
    const rates = [rate('chitchats', 'connect', 1747, 3, 8), rate('chitchats', 'courier', 1387, 4, 9), rate('other', 'edge', 1561, 3, 6)];
    expect(chooseQuotes(rates)).toEqual([
      { ...rates[1], label: 'Standard' },
      { ...rates[2], label: 'Express' },
    ]);
    expect(chooseQuotes([rates[1]])).toHaveLength(1);
    expect(chooseQuotes([])).toEqual([]);
  });

  it('quotes every vendor set up, and leaves out one that fails', async () => {
    const fake = (id: string, result: Rate[] | Error, configured = true) =>
      ({
        id,
        name: id,
        configured: () => configured,
        mode: () => 'test',
        quote: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      }) as unknown as ShippingProvider;
    const a = rate('chitchats', 'a', 900, 2, 5);
    const b = rate('chitchats', 'b', 500, 3, 9);
    expect(await quoteAll(request, {}, fetch, [fake('one', [a]), fake('two', [b]), fake('three', [], false)])).toEqual([b, a]);
    expect(await quoteAll(request, {}, fetch, [fake('one', [a]), fake('down', new Error('timeout'))])).toEqual([a]);
    await expect(quoteAll(request, {}, fetch, [fake('down', new Error('timeout'))])).rejects.toThrow(/timeout/);
    await expect(quoteAll(request, {}, fetch, [])).rejects.toThrow(/No shipping vendor/);
  });

  it('lists the vendors set up, live or test', () => {
    expect(configuredProviders({})).toEqual([]);
    expect(configuredProviders(env)).toEqual([{ id: 'chitchats', name: 'Chit Chats', mode: 'live' }]);
    expect(configuredProviders({ ...env, CHITCHATS_BASE_URL: 'https://staging.chitchats.com' })[0].mode).toBe('test');
  });
});

describe('Chit Chats', () => {
  it('is live by default, staging by setting, and refuses anything else', () => {
    expect(chitChatsMode(env)).toBe('live');
    expect(chitChatsMode({ ...env, CHITCHATS_BASE_URL: 'https://staging.chitchats.com/' })).toBe('test');
    expect(() => chitChatsMode({ ...env, CHITCHATS_BASE_URL: 'https://chitchats.example.com' })).toThrow(/must be/);
  });

  it('adds customs line items outside Canada, with origin and manufacturer', () => {
    const us = shipmentBody(request) as Record<string, unknown>;
    expect((us.line_items as Record<string, unknown>[])[0]).toMatchObject({
      quantity: 5,
      hs_tariff_code: HS_TARIFF_CODE,
      origin_country: 'CA',
      value_amount: '1.75',
      manufacturer_city: 'Toronto',
    });
    expect(us.value).toBe('8.75');
    const ca = shipmentBody({ ...request, to: { ...to, country: 'CA', state: 'ON' } }) as Record<string, unknown>;
    expect(ca.line_items).toBeUndefined();
    expect(ca.description).toBeTruthy();
  });

  it('maps its statuses to the common states', () => {
    expect(stateOf('ready')).toBe('label');
    expect(stateOf('inducted')).toBe('in_transit');
    expect(stateOf('postage_requested')).toBe('buying');
    expect(stateOf('canceled')).toBe('voided');
    expect(stateOf('refund_approved')).toBe('voided');
  });

  it('quotes, then deletes the draft shipment', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method} ${String(url)}`);
      if (init?.method === 'POST') {
        return json({ shipment: { id: 'ABC', status: 'unpaid', rates: [{ postage_type: 'chit_chats_slim', postage_description: 'Slim', payment_amount: '4.48', delivery_time_description: '3-9 estimated business days' }] } }, 201);
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    expect(await chitChats.quote(request, env, fetcher)).toEqual([
      { provider: 'chitchats', service: 'chit_chats_slim', name: 'Slim', amount: 448, days: { min: 3, max: 9 } },
    ]);
    expect(calls).toEqual(['POST https://chitchats.com/api/v1/clients/1/shipments', 'DELETE https://chitchats.com/api/v1/clients/1/shipments/ABC']);
  });

  it('buys on the unpaid shipment it already has, and waits while Chit Chats buys', async () => {
    vi.useFakeTimers();
    const statuses = ['unpaid', 'postage_requested', 'ready'];
    const calls: string[] = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).replace('https://chitchats.com/api/v1/clients/1', '')}`);
      if (init?.method === 'PATCH') return json({});
      return json({
        shipment: { id: 'S1', status: statuses.shift(), postage_type: 'chit_chats_select', purchase_amount: '10.82', carrier_tracking_code: 'T1', tracking_url: 'https://t', postage_label_pdf_url: 'https://l.pdf' },
      });
    }) as typeof fetch;
    const bought = chitChats.buy(request, 'chit_chats_select', env, 'S1', fetcher);
    await vi.runAllTimersAsync();
    expect(await bought).toEqual({
      provider: 'chitchats',
      id: 'S1',
      state: 'label',
      status: 'ready',
      service: 'chit_chats_select',
      cost: 1082,
      trackingCode: 'T1',
      trackingUrl: 'https://t',
      labelUrl: 'https://l.pdf',
    });
    expect(calls).toEqual(['GET /shipments/S1', 'PATCH /shipments/S1/buy', 'GET /shipments/S1', 'GET /shipments/S1']);
    vi.useRealTimers();
  });

  it('reports its errors with their detail', async () => {
    const fetcher = (async () => json({ error: { message: 'Not enough available credit.' } }, 400)) as typeof fetch;
    await expect(chitChats.buy(request, 'x', env, null, fetcher)).rejects.toThrow(/400.*Not enough available credit/);
  });
});
