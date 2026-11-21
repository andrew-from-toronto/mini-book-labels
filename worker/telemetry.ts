/**
 * POST /api/t: anonymous reports from the pages (src/lib/telemetry.ts), written as one JSON line each to
 * Workers Logs, where the dashboard's Observability tab can filter them (telemetry = "drag", say).
 * Only short flat values are kept, and the address is never logged; the browser and country are added
 * here from the request.
 */

const MAX_BODY = 4096;
const MAX_KEYS = 30;

type Value = string | number | boolean | null;

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

export async function handleTelemetry(request: Request): Promise<Response> {
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
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  console.log(
    JSON.stringify({
      telemetry: report.event,
      build: report.build,
      ...report.data,
      ua: (request.headers.get('user-agent') ?? '').slice(0, 300),
      country: cf?.country ?? null,
    }),
  );
  return new Response(null, { status: 204 });
}
