/**
 * Fixes from the security review: each test is one way someone might get around checkout, admin or the
 * webhook.
 */
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { encodeOrder } from '../src/lib/orderCode';
import { priceOrder } from '../src/lib/pricing';
import { dimsAtScale } from '../src/lib/scales';
import { printable } from '../src/lib/shop';
import { adminUser } from './access';
import { handleShipping, MAX_QUOTES } from './checkout';
import { orderFromSession, sessionProblems } from './webhook';

const dims = dimsAtScale(7);
const code = encodeOrder({ dims, options: { hook: false, hookPosition: 'center', hookSide: 'front', roundSpine: false }, colour: 'white' });
const paid = (over: Partial<Stripe.Checkout.Session> = {}) =>
  ({
    id: 'cs_1',
    metadata: { order_code: code, quantity: '5' },
    amount_subtotal: priceOrder(dims, 5).subtotal,
    amount_total: priceOrder(dims, 5).subtotal + 500,
    shipping_cost: { amount_total: 500 },
    collected_information: { shipping_details: { name: 'A', address: { line1: '1 St', city: 'Toronto', country: 'CA' } } },
    payment_status: 'paid',
    livemode: false,
    ...over,
  }) as unknown as Stripe.Checkout.Session;

describe('the webhook', () => {
  it('records only sessions our checkout made', () => {
    expect(orderFromSession(paid({ metadata: {}, client_reference_id: code }), 'paid')).toBeNull();
    expect(orderFromSession(paid(), 'paid')?.order_code).toBe(code);
  });

  it('flags a payment that does not match the price, or has no shipping', () => {
    expect(sessionProblems(paid())).toBeNull();
    expect(sessionProblems(paid({ amount_subtotal: 100 }))).toMatch(/paid 100 cents/);
    expect(sessionProblems(paid({ shipping_cost: null }))).toMatch(/no shipping charged/);
    expect(sessionProblems(paid({ collected_information: null }))).toMatch(/no shipping address/);
    expect(sessionProblems(paid({ metadata: { order_code: code, quantity: '999' } }))).toMatch(/not one this site sells/);
  });
});

describe('sizes', () => {
  it('bounds width and spine, not just height', () => {
    expect(printable(dims)).toBe(true);
    expect(printable({ height: 30, width: 0.1, spine: 5 })).toBe(false);
    expect(printable({ height: 30, width: 20, spine: 99 })).toBe(false);
    expect(printable({ height: 30, width: 40, spine: 5 })).toBe(false);
  });
});

describe('shipping quotes', () => {
  const env = {
    SHIP_FROM_NAME: 'Maker',
    SHIP_FROM_STREET: '1 St',
    SHIP_FROM_CITY: 'Toronto',
    SHIP_FROM_PROVINCE: 'ON',
    SHIP_FROM_POSTAL_CODE: 'M5V 1A1',
    SHIP_FROM_COUNTRY: 'CA',
  };
  const address = { name: 'Buyer', address: { line1: '20 W 34th St', city: 'New York', state: 'NY', postal_code: '10001', country: 'US' } };
  const request = (body: object) =>
    new Request('https://minibookornaments.com/api/checkout/shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://minibookornaments.com', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(body),
    });
  const stripeWith = (metadata: Record<string, string>) => {
    const updates: unknown[] = [];
    const stripe = {
      checkout: {
        sessions: {
          retrieve: async () => ({ id: 'cs_1', status: 'open', metadata: { order_code: code, quantity: '5', ...metadata } }),
          update: async (_id: string, params: unknown) => updates.push(params),
        },
      },
    } as unknown as Pick<Stripe, 'checkout'>;
    return { stripe, updates };
  };
  const quote = async () => [{ provider: 'chitchats' as const, service: 'slim', name: 'Slim', amount: 448, days: null }];

  it("needs the checkout's private token", async () => {
    const { stripe, updates } = stripeWith({ quote_token: 'secret' });
    const res = await handleShipping(request({ sessionId: 'cs_1', quoteToken: 'guess', shipping: address }), stripe, env, quote);
    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
    const ok = await handleShipping(request({ sessionId: 'cs_1', quoteToken: 'secret', shipping: address }), stripe, env, quote);
    expect(ok.status).toBe(200);
    expect((updates[0] as { metadata: { quotes: string } }).metadata.quotes).toBe('1');
  });

  it('caps quotes per checkout', async () => {
    const { stripe } = stripeWith({ quote_token: 't', quotes: String(MAX_QUOTES) });
    const res = await handleShipping(request({ sessionId: 'cs_1', quoteToken: 't', shipping: address }), stripe, env, quote);
    expect(res.status).toBe(429);
  });

  it('refuses fields of the wrong type cleanly', async () => {
    const { stripe } = stripeWith({ quote_token: 't' });
    const bad = { name: 'B', address: { ...address.address, country: 42 } };
    const res = await handleShipping(request({ sessionId: 'cs_1', quoteToken: 't', shipping: bad }), stripe, env, quote);
    expect(res.status).toBe(400);
  });
});

describe('admin sign-in', () => {
  it('refuses a token with no expiry', async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const part = (o: object) => b64(new TextEncoder().encode(JSON.stringify(o)));
    const domain = 'https://noexp.cloudflareaccess.com';
    const unsigned = `${part({ alg: 'RS256', kid: 'noexp' })}.${part({ aud: ['aud1'], iss: domain, email: 'me@example.com' })}`;
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned)));
    const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'noexp' };
    const certs = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch;
    const req = new Request('https://minibookornaments.com/api/admin/orders', { headers: { 'Cf-Access-Jwt-Assertion': `${unsigned}.${b64(signature)}` } });
    expect(await adminUser(req, { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: 'aud1' }, certs)).toBeNull();
  });
});
