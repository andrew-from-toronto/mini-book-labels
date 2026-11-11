import { describe, expect, it } from 'vitest';
import { adminUser } from './access';

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

describe('tracking moves orders on', async () => {
  const { statusFromTracking } = await import('./tracking');
  it('ships a labeled order once Chit Chats has it, and delivers on arrival', () => {
    expect(statusFromTracking('labeled', 'label')).toBeNull();
    expect(statusFromTracking('labeled', 'in_transit')).toBe('shipped');
    expect(statusFromTracking('shipped', 'in_transit')).toBeNull();
    expect(statusFromTracking('shipped', 'exception')).toBeNull();
    expect(statusFromTracking('shipped', 'delivered')).toBe('delivered');
    expect(statusFromTracking('labeled', 'delivered')).toBe('delivered');
    expect(statusFromTracking('delivered', 'delivered')).toBeNull();
  });
});
