import { describe, expect, it, vi } from 'vitest';
import { adminUser } from './access';
import { chitChatsShipments } from './chitchats';

const env = { CHITCHATS_API_KEY: 'k', CHITCHATS_CLIENT_ID: '1' };
const reply = (shipment: object) => new Response(JSON.stringify({ shipment }));

describe('buying a Chit Chats label', () => {
  it('requests the postage, then waits while Chit Chats buys it', async () => {
    const statuses = ['postage_requested', 'postage_requested', 'ready'];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return new Response('{}');
      return reply({ id: 's1', status: statuses.shift(), carrier_tracking_code: 'TRACK1' });
    });
    const waits: number[] = [];
    const shipment = await chitChatsShipments(env, fetcher as unknown as typeof fetch).buy('s1', 'chit_chats_select', async (ms) => {
      waits.push(ms);
    });
    expect(shipment).toMatchObject({ status: 'ready', carrier_tracking_code: 'TRACK1' });
    expect(waits).toEqual([1000, 1000]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chitchats.com/api/v1/clients/1/shipments/s1/buy');
    expect(JSON.parse(init.body as string)).toEqual({ postage_type: 'chit_chats_select' });
  });

  it('reports Chit Chats errors with their detail', async () => {
    const fetcher = async () => new Response('{"error":{"message":"Insufficient balance"}}', { status: 400 });
    await expect(chitChatsShipments(env, fetcher as unknown as typeof fetch).buy('s1', 'x')).rejects.toThrow(/400.*Insufficient balance/);
  });
});

/** A Cloudflare Access style token, signed with a fresh key. */
async function accessToken(claims: object) {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const part = (o: object) => b64(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${part({ alg: 'RS256', kid: 'k1' })}.${part(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned)));
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  return { token: `${unsigned}.${b64(signature)}`, certs: async () => new Response(JSON.stringify({ keys: [jwk] })) };
}

describe('admin access', () => {
  const access = { ACCESS_TEAM_DOMAIN: 'https://shop.cloudflareaccess.com', ACCESS_AUD: 'aud1' };
  const later = Math.floor(Date.now() / 1000) + 600;

  it('opens on localhost only when Access is not set up', async () => {
    expect(await adminUser(new Request('http://localhost:5199/api/admin/orders'), {})).toBe('local');
    expect(await adminUser(new Request('https://minibookornaments.com/api/admin/orders'), {})).toBeNull();
  });

  it('accepts a valid Access token and refuses forged, expired or other-app ones', async () => {
    const good = await accessToken({ aud: ['aud1'], iss: access.ACCESS_TEAM_DOMAIN, exp: later, email: 'me@example.com' });
    const at = (token: string) =>
      new Request('https://minibookornaments.com/api/admin/orders', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    expect(await adminUser(at(good.token), access, good.certs as unknown as typeof fetch)).toBe('me@example.com');
    expect(await adminUser(new Request('https://minibookornaments.com/api/admin/orders'), access, good.certs as unknown as typeof fetch)).toBeNull();

    const forged = good.token.slice(0, -4) + 'AAAA';
    expect(await adminUser(at(forged), access, good.certs as unknown as typeof fetch)).toBeNull();
    const expired = await accessToken({ aud: 'aud1', iss: access.ACCESS_TEAM_DOMAIN, exp: 1 });
    expect(await adminUser(at(expired.token), access, expired.certs as unknown as typeof fetch)).toBeNull();
    const otherApp = await accessToken({ aud: 'aud2', iss: access.ACCESS_TEAM_DOMAIN, exp: later });
    expect(await adminUser(at(otherApp.token), access, otherApp.certs as unknown as typeof fetch)).toBeNull();
  });
});

describe('Chit Chats live or staging', async () => {
  const { chitChatsMode } = await import('./chitchats');
  it('is live by default, staging by setting, and refuses anything else', () => {
    expect(chitChatsMode(env)).toBe('live');
    expect(chitChatsMode({ ...env, CHITCHATS_BASE_URL: 'https://staging.chitchats.com/' })).toBe('staging');
    expect(() => chitChatsMode({ ...env, CHITCHATS_BASE_URL: 'https://chitchats.example.com' })).toThrow(/must be/);
  });

  it('sends staging calls to staging', async () => {
    const fetcher = vi.fn(async () => reply({ id: 's1', status: 'unpaid' }));
    await chitChatsShipments({ ...env, CHITCHATS_BASE_URL: 'https://staging.chitchats.com' }, fetcher as unknown as typeof fetch).get('s1');
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe('https://staging.chitchats.com/api/v1/clients/1/shipments/s1');
  });
});

describe('tracking moves orders on', async () => {
  const { statusFromTracking } = await import('./tracking');
  it('ships a labeled order once Chit Chats has it, and delivers on arrival', () => {
    expect(statusFromTracking('labeled', 'ready')).toBeNull();
    expect(statusFromTracking('labeled', 'received')).toBe('shipped');
    expect(statusFromTracking('labeled', 'in_transit')).toBe('shipped');
    expect(statusFromTracking('shipped', 'in_transit')).toBeNull();
    expect(statusFromTracking('shipped', 'exception')).toBeNull();
    expect(statusFromTracking('shipped', 'delivered')).toBe('delivered');
    expect(statusFromTracking('labeled', 'delivered')).toBe('delivered');
    expect(statusFromTracking('delivered', 'delivered')).toBeNull();
  });
});
