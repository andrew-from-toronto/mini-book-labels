/**
 * Admin's usage numbers, read from Workers Analytics Engine with its SQL API
 * (https://developers.cloudflare.com/analytics/analytics-engine/sql-api/). The columns come from
 * src/lib/usage.ts. Needs ANALYTICS_API_TOKEN, a Cloudflare API token with Account Analytics: Read.
 *
 * Counts are weighted by _sample_interval, so they stay right if Analytics Engine samples.
 */
import { columnOf, type EventName } from '../src/lib/usage';

export interface UsageQueryEnv {
  ANALYTICS_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
}

export const DATASET = 'mini_book_labels_usage';
export const PERIODS = [7, 30, 90] as const;

const col = (event: EventName, field: string) => {
  const c = columnOf(event, field);
  if (!c) throw new Error(`${event} has no field ${field}`);
  return c;
};

const since = (days: number) => `timestamp > NOW() - INTERVAL '${days}' DAY`;
const N = 'SUM(_sample_interval)';

/** The breakdowns admin shows: a field of an event, top values first. */
export const BREAKDOWNS: { id: string; title: string; event: EventName; field: string; where?: string }[] = [
  { id: 'sources', title: 'Where visits come from', event: 'visit', field: 'source' },
  { id: 'referrers', title: 'Referring sites and pages', event: 'visit', field: 'referrer' },
  { id: 'library', title: 'How books came in', event: 'library', field: 'how' },
  { id: 'outputs', title: 'Where labels went', event: 'output', field: 'mode' },
  { id: 'scales', title: 'Scales printed', event: 'output', field: 'scale' },
  { id: 'backs', title: 'Back covers printed', event: 'output', field: 'back' },
  { id: 'covers', title: 'Cover changes', event: 'cover', field: 'how' },
  { id: 'views', title: 'Previews opened', event: 'view', field: 'view' },
  { id: 'searches', title: 'Book searches', event: 'search', field: 'found' },
  { id: 'models', title: '3D models downloaded, by scale', event: 'model-download', field: 'scale' },
  { id: 'orders', title: 'Shop steps', event: 'order', field: 'step' },
  { id: 'data', title: 'Backups and resets', event: 'data', field: 'action' },
  { id: 'drags', title: 'How drags ended', event: 'drag', field: 'outcome' },
  { id: 'failures', title: 'Failed outputs', event: 'output', field: 'error', where: `${columnOf('output', 'ok')} = 'no'` },
  { id: 'errors', title: 'Script errors', event: 'error', field: 'message' },
];

/** Which pages are visited, and from which device, browser and country: visitors each. */
const AUDIENCE: { id: string; title: string; column: string }[] = [
  { id: 'pages', title: 'Pages visited', column: 'blob4' },
  { id: 'devices', title: 'Devices', column: 'blob6' },
  { id: 'browsers', title: 'Browsers', column: 'blob7' },
  { id: 'countries', title: 'Countries', column: 'blob8' },
];

/** The SQL for every number on the usage page, keyed by what it is. */
export function usageQueries(days: number): Record<string, string> {
  const d = since(days);
  const labels = col('output', 'labels');
  const ok = `${col('output', 'ok')} = 'yes'`;
  const step = (v: string) => `blob1 = 'order' AND ${col('order', 'step')} = '${v}'`;
  const visitors = (where: string) => `SELECT COUNT(DISTINCT blob2) AS n FROM ${DATASET} WHERE ${d} AND ${where}`;
  const sum = (expr: string, where: string) => `SELECT SUM(_sample_interval * ${expr}) AS n FROM ${DATASET} WHERE ${d} AND ${where}`;
  const delivered = `blob1 = 'output' AND ${ok}`;
  // Plain queries, one number or one grouping each.
  const q: Record<string, string> = {
    // Every event: how many, and by how many visitors.
    events: `SELECT blob1 AS event, ${N} AS n, COUNT(DISTINCT blob2) AS visitors FROM ${DATASET} WHERE ${d} GROUP BY event ORDER BY n DESC`,
    // Each day: visitors, and labels delivered (the north star).
    dailyVisitors: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, COUNT(DISTINCT blob2) AS n FROM ${DATASET} WHERE ${d} GROUP BY day ORDER BY day`,
    dailyLabels: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, SUM(_sample_interval * ${labels}) AS n FROM ${DATASET} WHERE ${d} AND ${delivered} GROUP BY day ORDER BY day`,
    // The funnel, in visitors: in the app, books in, labels out, then the shop.
    'funnel.app': visitors(`blob1 = 'visit' AND blob4 = 'app'`),
    'funnel.books': visitors(`blob1 IN ('library', 'book-added')`),
    'funnel.labels': visitors(delivered),
    'funnel.shop': visitors(`(blob1 = 'model-download' OR (${step('page')}))`),
    'funnel.checkout': visitors(step('checkout')),
    'funnel.paid': visitors(step('paid')),
    // Headline numbers.
    'total.visitors': visitors(`blob1 = 'visit'`),
    'total.returning': visitors(`blob1 = 'visit' AND blob9 = 'returning'`),
    'total.labels': sum(labels, delivered),
    'total.coversFound': sum(col('output', 'found'), delivered),
    'total.coversGenerated': sum(col('output', 'generated'), delivered),
    'total.coversReplaced': sum(col('output', 'replaced'), delivered),
    'total.orders': `SELECT ${N} AS n FROM ${DATASET} WHERE ${d} AND ${step('paid')}`,
    'total.revenue': sum(col('order', 'amount'), step('paid')),
  };
  for (const b of BREAKDOWNS) {
    const c = col(b.event, b.field);
    q[b.id] = `SELECT ${c} AS value, ${N} AS n FROM ${DATASET} WHERE ${d} AND blob1 = '${b.event}'${b.where ? ` AND ${b.where}` : ''} GROUP BY value ORDER BY n DESC LIMIT 12`;
  }
  for (const a of AUDIENCE) {
    q[a.id] = `SELECT ${a.column} AS value, COUNT(DISTINCT blob2) AS n FROM ${DATASET} WHERE ${d} AND blob1 = 'visit' GROUP BY value ORDER BY n DESC LIMIT 12`;
  }
  return q;
}

export const SECTIONS = [...BREAKDOWNS.map(({ id, title }) => ({ id, title })), ...AUDIENCE.map(({ id, title }) => ({ id, title }))];

type Row = Record<string, string | number | null>;

/** Numbers come back from the SQL API as strings; make them numbers. */
const numeric = (rows: Row[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])));

export async function runQuery(env: UsageQueryEnv, sql: string, fetcher: typeof fetch = fetch): Promise<Row[]> {
  const res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` },
    body: `${sql} FORMAT JSON`,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}: ${body.slice(0, 300)}`);
  return numeric((JSON.parse(body) as { data?: Row[] }).data ?? []);
}

/** Everything the usage page shows, for the last `days` days. */
export async function usageReport(env: UsageQueryEnv, days: number, fetcher: typeof fetch = fetch) {
  const queries = usageQueries(days);
  const entries = await Promise.all(
    Object.entries(queries).map(async ([key, sql]) => {
      try {
        return [key, await runQuery(env, sql, fetcher)] as const;
      } catch (e) {
        return [key, { error: e instanceof Error ? e.message : String(e) }] as const;
      }
    }),
  );
  return { days, sections: SECTIONS, results: Object.fromEntries(entries) };
}
