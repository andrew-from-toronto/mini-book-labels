/**
 * Admin is behind Cloudflare Access, which signs in the shop owner and adds a signed JWT to each request
 * (Cf-Access-Jwt-Assertion). The Worker checks that token itself, so admin stays closed even if the
 * Access rule is ever changed or bypassed. See
 * https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 *
 * Locally, with no Access settings, admin opens only on localhost.
 */
export interface AccessEnv {
  /** The Zero Trust team domain, e.g. https://minibookornaments.cloudflareaccess.com */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's Audience (AUD) tag. */
  ACCESS_AUD?: string;
}

interface Jwk extends JsonWebKey {
  kid: string;
}

const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = <T>(part: string) => JSON.parse(new TextDecoder().decode(decode(part))) as T;

let keys: { domain: string; at: number; keys: Jwk[] } | null = null;

async function accessKeys(domain: string, fetcher: typeof fetch, fresh = false): Promise<Jwk[]> {
  // Cloudflare rotates these keys; an hour's cache is well inside their overlap.
  if (!fresh && keys && keys.domain === domain && Date.now() - keys.at < 3_600_000) return keys.keys;
  const res = await fetcher(`${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  keys = { domain, at: Date.now(), keys: ((await res.json()) as { keys: Jwk[] }).keys };
  return keys.keys;
}

/** The signed-in email when the request may use admin, or null. */
export async function adminUser(request: Request, env: AccessEnv, fetcher: typeof fetch = fetch): Promise<string | null> {
  const domain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/\/$/, '');
  const aud = env.ACCESS_AUD?.trim();
  if (!domain || !aud) {
    const host = new URL(request.url).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? 'local' : null;
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature) return null;
  try {
    const header = json<{ kid: string; alg: string }>(head);
    if (header.alg !== 'RS256') return null;
    // An unknown key may be a new one: fetch the keys again before refusing.
    const jwk =
      (await accessKeys(domain, fetcher)).find((k) => k.kid === header.kid) ??
      (await accessKeys(domain, fetcher, true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature), new TextEncoder().encode(`${head}.${body}`));
    if (!valid) return null;
    const claims = json<{ aud: string | string[]; exp: number; iss: string; email?: string }>(body);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(aud) || claims.iss !== domain || claims.exp * 1000 < Date.now()) return null;
    return claims.email ?? 'access';
  } catch {
    return null;
  }
}
