/**
 * Re-serves a pasted image (full wraparound artwork, often from Pinterest) from our own address, so the
 * app can read its pixels to find the spine and trim borders; most image hosts send no CORS headers.
 *
 * An open image proxy is easy to abuse, so this one only answers our own pages, only returns images,
 * caps their size, refuses addresses on private networks, and caches what it fetches.
 */
import { cachedFetch, json, type CacheContext } from './cache';
import { USER_AGENT } from './openLibrary';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DAY = 86_400;

/** Only our own pages may use the proxy: browsers say so in Sec-Fetch-Site, or older ones in Origin or Referer. */
export function fromOwnSite(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';
  const own = new URL(request.url).host;
  for (const header of ['Origin', 'Referer']) {
    const value = request.headers.get(header);
    if (value) {
      try {
        return new URL(value).host === own;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** Public http(s) addresses only: no credentials, no local or private network hosts. */
export function allowedImageUrl(raw: string | null): URL | null {
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127|10|0)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('[');
  return privateHost ? null : url;
}

export async function handleImage(request: Request, context: CacheContext, fetcher: typeof fetch = fetch) {
  if (!fromOwnSite(request)) return json(403, { error: 'This image proxy only serves this site.' });
  const target = allowedImageUrl(new URL(request.url).searchParams.get('url'));
  if (!target) return json(400, { error: 'Give a public http or https image address.' });

  return cachedFetch(request, context, { found: DAY, notFound: DAY }, async () => {
    let upstream: Response;
    try {
      upstream = await fetcher(target.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' } });
    } catch {
      return json(502, { error: 'Could not fetch that image.' });
    }
    if (upstream.status === 404) return json(404, { error: 'No image at that address.' });
    if (!upstream.ok) return json(502, { error: `The image host answered ${upstream.status}.` });
    const type = upstream.headers.get('Content-Type') ?? '';
    if (!type.startsWith('image/') || type.includes('svg')) {
      // SVG can carry script, so only raster images are passed on.
      return json(415, { error: 'That address is not a picture (JPEG, PNG, WebP, GIF or AVIF).' });
    }
    if (Number(upstream.headers.get('Content-Length') ?? 0) > MAX_IMAGE_BYTES) {
      return json(413, { error: 'That image is over 10 MB.' });
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) return json(413, { error: 'That image is over 10 MB.' });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' },
    });
  });
}
