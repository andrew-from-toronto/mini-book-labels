/**
 * Edge caching for upstream lookups: a hit is answered from Cloudflare's cache without touching the
 * upstream service. Only answers worth repeating are kept (found, or definitely not found); errors and
 * rate-limit refusals pass through uncached so the next request tries again.
 */

/** The subset of the Cache API used here, so tests can pass a stand-in. */
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface CacheContext {
  cache: EdgeCache;
  waitUntil(promise: Promise<unknown>): void;
}

/** Seconds to keep answers: found, and not found. */
export interface Lifetimes {
  found: number;
  notFound: number;
}

export async function cachedFetch(
  request: Request,
  context: CacheContext,
  lifetimes: Lifetimes,
  load: () => Promise<Response>,
): Promise<Response> {
  // Keyed by the full URL, including the query, on a plain GET so HEAD requests share the entry.
  const key = new Request(request.url, { method: 'GET' });
  const hit = await context.cache.match(key);
  if (hit) return hit;

  const upstream = await load();
  const keep = upstream.status === 200 ? lifetimes.found : upstream.status === 404 ? lifetimes.notFound : 0;
  if (!keep) return upstream;

  const response = new Response(upstream.body, upstream);
  response.headers.set('Cache-Control', `public, max-age=${keep}`);
  response.headers.delete('Set-Cookie');
  context.waitUntil(context.cache.put(key, response.clone()));
  return response;
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
