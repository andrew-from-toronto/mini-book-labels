import { describe, expect, it } from 'vitest';
import type { CacheContext } from './cache';
import { allowedImageUrl, fromOwnSite, handleImage, MAX_IMAGE_BYTES } from './imageProxy';
import { handleOpenLibrary, upstreamFor, USER_AGENT } from './openLibrary';

const SITE = 'https://minibookornaments.com';

/** An in-memory stand-in for Cloudflare's edge cache. */
function memoryCache() {
  const store = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  const context: CacheContext = {
    cache: {
      match: async (r) => store.get(r.url)?.clone(),
      put: async (r, res) => void store.set(r.url, res),
    },
    waitUntil: (p) => void pending.push(p),
  };
  return { context, store, settle: () => Promise.all(pending) };
}

/** A fetch stand-in that records calls and answers from a script. */
function scriptedFetch(answer: (url: string) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input));
  }) as typeof fetch;
  return { fetcher, calls };
}

describe('upstreamFor', () => {
  const up = (path: string) => upstreamFor(new URL(path, SITE))?.target;

  it('passes on the searches the app makes, keeping only known parameters and capping the limit', () => {
    expect(up('/api/ol/search?q=piranesi&fields=key,title&limit=8&evil=1')).toBe(
      'https://openlibrary.org/search.json?q=piranesi&fields=key%2Ctitle&limit=8',
    );
    expect(up('/api/ol/search?isbn=9781635575637&limit=500')).toBe(
      'https://openlibrary.org/search.json?isbn=9781635575637&limit=20',
    );
    expect(up('/api/ol/search?fields=key')).toBeUndefined();
  });

  it('passes on edition lists, edition records and covers by strict pattern', () => {
    expect(up('/api/ol/works/OL27448W/editions')).toBe('https://openlibrary.org/works/OL27448W/editions.json?limit=200');
    expect(up('/api/ol/books/OL28300471M')).toBe('https://openlibrary.org/books/OL28300471M.json');
    expect(up('/api/cover/isbn/080442957X-L.jpg')).toBe(
      'https://covers.openlibrary.org/b/isbn/080442957X-L.jpg?default=false',
    );
    expect(up('/api/cover/id/12345-S.jpg')).toBe('https://covers.openlibrary.org/b/id/12345-S.jpg?default=false');
    const bad = ['/api/ol/works/../../admin', '/api/ol/books/OL1W', '/api/cover/id/1-X.jpg', '/api/cover/isbn/123-L.jpg', '/api/ol/other'];
    for (const path of bad) expect(up(path)).toBeUndefined();
  });
});

describe('handleOpenLibrary', () => {
  it('fetches once with our user agent, then answers from the cache', async () => {
    const { context, settle } = memoryCache();
    const { fetcher, calls } = scriptedFetch(
      () => new Response('{"docs":[]}', { headers: { 'Content-Type': 'application/json' } }),
    );
    const request = new Request(`${SITE}/api/ol/search?q=dune&limit=1`);
    const first = await handleOpenLibrary(request, context, fetcher);
    await settle();
    const second = await handleOpenLibrary(request, context, fetcher);
    expect(await first.text()).toBe('{"docs":[]}');
    expect(await second.text()).toBe('{"docs":[]}');
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init?.headers).get('User-Agent')).toBe(USER_AGENT);
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('turns rate limiting into a retryable 503 that is not cached', async () => {
    const { context, settle, store } = memoryCache();
    const { fetcher } = scriptedFetch(() => new Response('slow down', { status: 429 }));
    const response = await handleOpenLibrary(new Request(`${SITE}/api/cover/id/1-M.jpg`), context, fetcher);
    await settle();
    expect(response.status).toBe(503);
    expect(store.size).toBe(0);
  });

  it('caches missing covers too, so they are not asked for again', async () => {
    const { context, settle, store } = memoryCache();
    const { fetcher } = scriptedFetch(() => new Response('', { status: 404 }));
    const request = new Request(`${SITE}/api/cover/isbn/9780000000002-L.jpg`);
    const response = await handleOpenLibrary(request, context, fetcher);
    await settle();
    expect(response.status).toBe(404);
    expect(store.size).toBe(1);
  });

  it('refuses paths it does not pass on', async () => {
    const { context } = memoryCache();
    const { fetcher, calls } = scriptedFetch(() => new Response(''));
    expect((await handleOpenLibrary(new Request(`${SITE}/api/ol/people/me`), context, fetcher)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('image proxy', () => {
  const ownRequest = (url: string, headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' }) =>
    new Request(`${SITE}/api/image?url=${encodeURIComponent(url)}`, { headers });

  it('serves only our own pages', () => {
    expect(fromOwnSite(ownRequest('x'))).toBe(true);
    expect(fromOwnSite(ownRequest('x', { 'Sec-Fetch-Site': 'cross-site' }))).toBe(false);
    expect(fromOwnSite(ownRequest('x', { Referer: `${SITE}/` }))).toBe(true);
    expect(fromOwnSite(ownRequest('x', { Origin: 'https://evil.example' }))).toBe(false);
    expect(fromOwnSite(ownRequest('x', {}))).toBe(false);
  });

  it('accepts public http(s) addresses only', () => {
    expect(allowedImageUrl('https://i.pinimg.com/736x/ab/cd/ef.jpg')).not.toBeNull();
    const bad = [
      null,
      'ftp://x/y.png',
      'https://user:pw@host/x.png',
      'http://localhost/x.png',
      'http://127.0.0.1/x',
      'http://10.0.0.2/x',
      'http://192.168.1.1/x',
      'http://172.20.0.1/x',
      'http://169.254.169.254/latest',
      'http://[::1]/x',
      'not a url',
    ];
    for (const url of bad) expect(allowedImageUrl(url)).toBeNull();
  });

  it('passes images through and refuses everything else', async () => {
    const answers: Record<string, () => Response> = {
      'https://img.example/a.png': () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }),
      'https://img.example/page': () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
      'https://img.example/b.svg': () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
      'https://img.example/huge.jpg': () =>
        new Response('x', {
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(MAX_IMAGE_BYTES + 1) },
        }),
    };
    const { fetcher } = scriptedFetch((url) => (answers[url] ?? (() => new Response('', { status: 404 })))());
    const status = async (url: string, headers?: Record<string, string>) =>
      (await handleImage(ownRequest(url, headers), memoryCache().context, fetcher)).status;

    expect(await status('https://img.example/a.png')).toBe(200);
    expect(await status('https://img.example/page')).toBe(415);
    expect(await status('https://img.example/b.svg')).toBe(415);
    expect(await status('https://img.example/huge.jpg')).toBe(413);
    expect(await status('https://img.example/missing.png')).toBe(404);
    expect(await status('http://localhost/a.png')).toBe(400);
    expect(await status('https://img.example/a.png', { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
  });
});
