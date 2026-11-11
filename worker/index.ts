/**
 * The site's Worker. Cloudflare serves the built site (dist) directly; only /api/* reaches this code.
 */
import Stripe from 'stripe';
import type { AccessEnv } from './access';
import { handleAdmin } from './admin';
import { json } from './cache';
import { handleCheckout, handleShipping } from './checkout';
import type { ShippingEnv } from './shipping';
import { handleImage } from './imageProxy';
import { handleOpenLibrary } from './openLibrary';
import type { MailEnv } from './mail';
import { emailOrder, orderDetails, recordDelivery } from './orderEmails';
import type { ShipFromEnv } from './shipFrom';
import { refreshTracking } from './tracking';
import { handleWebhook } from './webhook';

/** Secrets and bindings: .dev.vars locally, Worker secrets and wrangler.jsonc in production. */
export interface Env extends ShippingEnv, ShipFromEnv, MailEnv, AccessEnv {
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
      case '/api/stripe/webhook': {
        const stripe = stripeFor(env);
        return handleWebhook(request, env, stripe, async (order, session) => {
          const details = await orderDetails(session, stripe, url.origin);
          if (!details) return;
          await recordDelivery(env.ORDERS, order.session_id, details);
          await emailOrder(env.ORDERS, env, order.session_id, details);
        });
      }
    }

    if (path.startsWith('/api/admin/')) return handleAdmin(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });
    const context = { cache: caches.default, waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
    if (path.startsWith('/api/ol/') || path.startsWith('/api/cover/')) return handleOpenLibrary(request, context);
    if (path === '/api/image') return handleImage(request, context);
    return json(404, { error: 'Not found.' });
  },

  /** On the schedule in wrangler.jsonc: checks shipped orders' tracking with Chit Chats. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshTracking(env.ORDERS, env).then((r) => console.log('tracking checked', r)));
  },
} satisfies ExportedHandler<Env>;
