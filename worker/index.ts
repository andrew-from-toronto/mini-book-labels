/**
 * The site's Worker. Cloudflare serves the built site (dist) directly; only /api/* reaches this code.
 */
import Stripe from 'stripe';
import { json } from './cache';
import { handleCheckout, handleShipping } from './checkout';
import type { ChitChatsEnv } from './chitchats';
import { handleImage } from './imageProxy';
import { handleOpenLibrary } from './openLibrary';
import type { ShipFromEnv } from './shipFrom';
import { handleWebhook } from './webhook';

/** Secrets and bindings: .dev.vars locally, Worker secrets and wrangler.jsonc in production. */
export interface Env extends ChitChatsEnv, ShipFromEnv {
  STRIPE_API_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  ORDERS: D1Database;
}

/** A Stripe client per request, using fetch (Workers have no Node HTTP). Pinned to the SDK's API version. */
const stripeFor = (env: Env) => new Stripe(env.STRIPE_API_KEY, { httpClient: Stripe.createFetchHttpClient() });

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/api/checkout':
        return handleCheckout(request, stripeFor(env), env.STRIPE_PUBLISHABLE_KEY);
      case '/api/checkout/shipping':
        return handleShipping(request, stripeFor(env), env);
      case '/api/stripe/webhook':
        return handleWebhook(request, env, stripeFor(env));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });
    const context = { cache: caches.default, waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
    if (path.startsWith('/api/ol/') || path.startsWith('/api/cover/')) return handleOpenLibrary(request, context);
    if (path === '/api/image') return handleImage(request, context);
    return json(404, { error: 'Not found.' });
  },
} satisfies ExportedHandler<Env>;
