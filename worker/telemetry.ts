/**
 * POST /api/t: anonymous reports from the pages (src/lib/telemetry.ts). Usage events (src/lib/usage.ts)
 * go to Workers Analytics Engine, one row each, for admin's usage page; drag and error reports, and
 * anything not in that table, are also written as one JSON line to Workers Logs, where the dashboard's
 * Observability tab can filter them. Only short flat values are kept, and the address is never stored;
 * the device type, browser and country are worked out here from the request.
 */
import { COMMON_BLOBS, EVENTS, isEvent, type EventName, type EventShape } from '../src/lib/usage';

const MAX_BODY = 4096;
const MAX_KEYS = 30;

type Value = string | number | boolean | null;

export interface UsageEnv {
  /** Workers Analytics Engine dataset for usage events (wrangler.jsonc); missing in tests and locally. */
  USAGE?: AnalyticsEngineDataset;
}

/** The report cut down to what is allowed, or null if it is not one. */
export function cleanReport(body: unknown): { event: string; build: string; data: Record<string, Value> } | null {
  if (!body || typeof body !== 'object') return null;
  const { event, build, data } = body as Record<string, unknown>;
  if (typeof event !== 'string' || !/^[a-z][a-z-]{0,39}$/.test(event)) return null;
  const clean: Record<string, Value> = {};
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data).slice(0, MAX_KEYS)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,29}$/.test(key)) continue;
      if (typeof value === 'string') clean[key] = value.slice(0, 200);
      else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = Math.round(value * 100) / 100;
      else if (typeof value === 'boolean' || value === null) clean[key] = value;
    }
  }
  return { event, build: typeof build === 'string' ? build.slice(0, 80) : '', data: clean };
}

/** phone, tablet or desktop, from the page's own pointer and screen size. */
export function deviceOf(data: Record<string, Value>): string {
  const vw = Number(data.vw) || 0;
  const vh = Number(data.vh) || 0;
  if (data.coarse !== true) return 'desktop';
  return Math.min(vw, vh) < 600 ? 'phone' : 'tablet';
}

/** The browser family, from its user agent. */
export function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/CriOS\/|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}

const ID = /^[a-z0-9-]{8,40}$/;
const id = (v: Value | undefined) => (typeof v === 'string' && ID.test(v) ? v : '');
const text = (v: Value | undefined) => (v === undefined || v === null ? '' : v === true ? 'yes' : v === false ? 'no' : String(v).slice(0, 200));

/** The Analytics Engine row for a usage event, in the column order of src/lib/usage.ts. */
export function usageRow(
  event: EventName,
  build: string,
  data: Record<string, Value>,
  ua: string,
  country: string | null,
): AnalyticsEngineDataPoint {
  const shape: EventShape = EVENTS[event];
  const visitor = id(data.visitor);
  const common: Record<(typeof COMMON_BLOBS)[number], string> = {
    event,
    visitor,
    session: id(data.session),
    page: text(data.page).slice(0, 40),
    build,
    device: deviceOf(data),
    browser: browserOf(ua),
    country: country ?? '',
    returning: data.returning === true ? 'returning' : 'new',
  };
  return {
    // Sampling, when Analytics Engine needs it, keeps or drops a visitor's events together.
    indexes: [visitor || 'none'],
    blobs: [...COMMON_BLOBS.map((k) => common[k]), ...shape.text.map((f) => text(data[f]))],
    doubles: shape.num.map((f) => (typeof data[f] === 'number' ? (data[f] as number) : Number(data[f]) || 0)),
  };
}

/** Logged as well as counted: the reports for debugging, and anything not in the usage table. */
const LOGGED = new Set(['drag', 'error']);

export async function handleTelemetry(request: Request, env: UsageEnv = {}): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const text = await request.text();
  if (text.length > MAX_BODY) return new Response(null, { status: 413 });
  let report: ReturnType<typeof cleanReport> = null;
  try {
    report = cleanReport(JSON.parse(text));
  } catch {
    /* not JSON */
  }
  if (!report) return new Response(null, { status: 400 });
  const ua = (request.headers.get('user-agent') ?? '').slice(0, 300);
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  if (isEvent(report.event)) {
    try {
      env.USAGE?.writeDataPoint(usageRow(report.event, report.build, report.data, ua, country));
    } catch (e) {
      console.error('usage write failed', e);
    }
  }
  if (!isEvent(report.event) || LOGGED.has(report.event)) {
    console.log(JSON.stringify({ telemetry: report.event, build: report.build, ...report.data, ua, country }));
  }
  return new Response(null, { status: 204 });
}

/** A usage event written by the Worker itself (an order paid), in the same table as the pages'. */
export function writeUsage(env: UsageEnv, event: EventName, data: Record<string, Value>, country: string | null = null) {
  try {
    env.USAGE?.writeDataPoint(usageRow(event, 'worker', { page: 'worker', ...data }, '', country));
  } catch (e) {
    console.error('usage write failed', e);
  }
}
