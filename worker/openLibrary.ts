/**
 * Open Library through our own address, cached at the edge. Open Library limits cover lookups to about
 * 100 per 5 minutes per address; cached answers mean each book is fetched once, not once per visitor.
 * Only the requests the app makes are passed on, with their parameters checked.
 *
 *   /api/ol/search?...                   -> openlibrary.org/search.json (q, title, author, isbn, fields, limit)
 *   /api/ol/works/OL123W/editions        -> openlibrary.org/works/OL123W/editions.json?limit=200
 *   /api/ol/books/OL123M                 -> openlibrary.org/books/OL123M.json
 *   /api/cover/isbn/9780140328721-L.jpg  -> covers.openlibrary.org/b/isbn/9780140328721-L.jpg?default=false
 *   /api/cover/id/12345-M.jpg            -> covers.openlibrary.org/b/id/12345-M.jpg?default=false
 */
import { cachedFetch, json, type CacheContext, type Lifetimes } from './cache';

/** Open Library asks automated clients to identify themselves. */
export const USER_AGENT = 'MiniBookLabels/1.0 (+https://minibookornaments.com)';

const DAY = 86_400;
const SEARCH: Lifetimes = { found: DAY, notFound: DAY };
const RECORDS: Lifetimes = { found: 7 * DAY, notFound: DAY };
const COVERS: Lifetimes = { found: 30 * DAY, notFound: DAY };

const SEARCH_PARAMS = ['q', 'title', 'author', 'isbn', 'fields'];
const MAX_LIMIT = 20;

/** The upstream URL and cache lifetimes for an /api/ol or /api/cover path, or null if it is not one we pass on. */
export function upstreamFor(url: URL): { target: string; lifetimes: Lifetimes } | null {
  const path = url.pathname;
  if (path === '/api/ol/search') {
    const params = new URLSearchParams();
    for (const name of SEARCH_PARAMS) {
      const value = url.searchParams.get(name);
      if (value) params.set(name, value.slice(0, 200));
    }
    if (![...params.keys()].some((k) => k !== 'fields')) return null;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 1));
    params.set('limit', String(limit));
    return { target: `https://openlibrary.org/search.json?${params}`, lifetimes: SEARCH };
  }
  let m = path.match(/^\/api\/ol\/works\/(OL\d+W)\/editions$/);
  if (m) return { target: `https://openlibrary.org/works/${m[1]}/editions.json?limit=200`, lifetimes: RECORDS };
  m = path.match(/^\/api\/ol\/books\/(OL\d+M)$/);
  if (m) return { target: `https://openlibrary.org/books/${m[1]}.json`, lifetimes: RECORDS };
  m = path.match(/^\/api\/cover\/(isbn\/(?:\d{9}[\dX]|\d{13})|id\/\d{1,12})-([SML])\.jpg$/);
  if (m) return { target: `https://covers.openlibrary.org/b/${m[1]}-${m[2]}.jpg?default=false`, lifetimes: COVERS };
  return null;
}

export async function handleOpenLibrary(request: Request, context: CacheContext, fetcher: typeof fetch = fetch) {
  const upstream = upstreamFor(new URL(request.url));
  if (!upstream) return json(404, { error: 'Not an Open Library request this site makes.' });
  return cachedFetch(request, context, upstream.lifetimes, async () => {
    try {
      const response = await fetcher(upstream.target, { headers: { 'User-Agent': USER_AGENT } });
      if (response.status === 429 || response.status >= 500) {
        return json(503, { error: 'Open Library is busy. Try again in a moment.' });
      }
      return response;
    } catch {
      return json(502, { error: 'Could not reach Open Library.' });
    }
  });
}
