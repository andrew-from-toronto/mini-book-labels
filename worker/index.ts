/**
 * The site's Worker. Cloudflare serves the built site (dist) directly; only /api/* reaches this code.
 */
import { json } from './cache';
import { handleImage } from './imageProxy';
import { handleOpenLibrary } from './openLibrary';

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });

    const context = { cache: caches.default, waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
    if (url.pathname.startsWith('/api/ol/') || url.pathname.startsWith('/api/cover/')) {
      return handleOpenLibrary(request, context);
    }
    if (url.pathname === '/api/image') return handleImage(request, context);
    return json(404, { error: 'Not found.' });
  },
} satisfies ExportedHandler;
