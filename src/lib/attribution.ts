/**
 * Which campaign link brought a buyer, so admin can see which ads and posts lead to orders without an ad
 * pixel or cookie. A visit whose address has utm_* parameters saves them in this browser for 30 days; the
 * order page sends them with the checkout, and the Worker puts them on the Stripe session and the order.
 * Shared with the Worker, which cleans what the browser sends with the same rules.
 */

export const SOURCE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export type Source = Partial<Record<SourceKey, string>>;

const STORAGE_KEY = 'mbo-source';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LENGTH = 100;

/** Only the known keys, each a short plain value; anything else is dropped. Empty when nothing is left. */
export function cleanSource(raw: unknown): Source {
  const out: Source = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of SOURCE_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    const v = value.trim().replace(/[^\p{L}\p{N} ._\-+:/|]/gu, '').slice(0, MAX_LENGTH);
    if (v) out[key] = v;
  }
  return out;
}

/** The utm_* parameters in a query string. */
export function sourceFromSearch(search: string): Source {
  const params = new URLSearchParams(search);
  return cleanSource(Object.fromEntries(SOURCE_KEYS.map((k) => [k, params.get(k) ?? undefined])));
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Saves the campaign in this visit's address, if it has one; the latest campaign link wins. */
export function captureSource(search: string, store: Store | null = storage(), now = Date.now()): void {
  const source = sourceFromSearch(search);
  if (!store || !source.utm_source) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ at: now, source }));
  } catch {
    // Storage full or blocked: the order just won't say where it came from.
  }
}

/** The saved campaign, if it is under 30 days old. */
export function savedSource(store: Store | null = storage(), now = Date.now()): Source {
  if (!store) return {};
  try {
    const saved = JSON.parse(store.getItem(STORAGE_KEY) ?? 'null') as { at?: number; source?: unknown } | null;
    if (!saved || typeof saved.at !== 'number' || now - saved.at > KEEP_MS) {
      store.removeItem(STORAGE_KEY);
      return {};
    }
    return cleanSource(saved.source);
  } catch {
    return {};
  }
}

/** "pinterest / cpc / holiday-test", for admin. */
export const describeSource = (s: Source): string =>
  [s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term].filter(Boolean).join(' / ');
