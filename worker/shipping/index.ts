/**
 * Every shipping vendor, and what is done across them. To add a vendor: write a ShippingProvider in this
 * folder (see ./types.ts and ./chitchats.ts), add its id to ProviderId, its settings to ShippingEnv and
 * .dev.vars.example, and list it in PROVIDERS. Checkout and admin pick it up once its settings are set.
 */
import { chitChats, type ChitChatsEnv } from './chitchats';
import { ShippingError, type ProviderId, type Rate, type ShipmentRequest, type ShippingProvider } from './types';

export * from './types';
export { SHIPPING_COUNTRIES } from './countries';

/** Every vendor's settings. */
export type ShippingEnv = ChitChatsEnv;

export const PROVIDERS: ShippingProvider<ShippingEnv>[] = [chitChats];

export function providerFor(id: string): ShippingProvider<ShippingEnv> {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new ShippingError(`No shipping vendor called ${id}.`);
  return provider;
}

/** The vendors with settings, and whether each is live or in test mode (or why its settings are wrong). */
export function configuredProviders(env: ShippingEnv): { id: ProviderId; name: string; mode: 'live' | 'test' | string }[] {
  return PROVIDERS.filter((p) => p.configured(env)).map((p) => {
    try {
      return { id: p.id, name: p.name, mode: p.mode(env) };
    } catch (e) {
      return { id: p.id, name: p.name, mode: e instanceof Error ? e.message : 'misconfigured' };
    }
  });
}

/**
 * Rates from every configured vendor, cheapest first. A vendor that fails is left out; if every one fails,
 * or none is configured, this throws.
 */
export async function quoteAll(
  request: ShipmentRequest,
  env: ShippingEnv,
  fetcher: typeof fetch = fetch,
  all: ShippingProvider<ShippingEnv>[] = PROVIDERS,
): Promise<Rate[]> {
  const providers = all.filter((p) => p.configured(env));
  if (!providers.length) throw new ShippingError('No shipping vendor is set up.');
  const results = await Promise.allSettled(providers.map((p) => p.quote(request, env, fetcher)));
  const failures = results.flatMap((r, i) => (r.status === 'rejected' ? [`${providers[i].name}: ${r.reason instanceof Error ? r.reason.message : r.reason}`] : []));
  if (failures.length) console.error('shipping quotes failed', failures);
  if (failures.length === providers.length) throw new ShippingError(failures.join('; '));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => a.amount - b.amount);
}

/** A choice offered at checkout. */
export interface ShippingQuote extends Rate {
  /** What the buyer sees: Standard, or Express. */
  label: 'Standard' | 'Express';
}

/**
 * At most two choices, from any vendors: the cheapest as Standard, and the fastest as Express if it
 * arrives sooner. Fewer, clearer options than every service every vendor offers.
 */
export function chooseQuotes(rates: Rate[]): ShippingQuote[] {
  const sorted = rates.filter((r) => Number.isFinite(r.amount) && r.amount > 0).sort((a, b) => a.amount - b.amount);
  if (!sorted.length) return [];
  const cheapest = sorted[0];
  const fastest = [...sorted].filter((r) => r.days).sort((a, b) => a.days!.max - b.days!.max || a.amount - b.amount)[0];
  const sooner = fastest && cheapest.days && fastest.days!.max < cheapest.days.max;
  return sooner
    ? [
        { ...cheapest, label: 'Standard' },
        { ...fastest, label: 'Express' },
      ]
    : [{ ...cheapest, label: 'Standard' }];
}
