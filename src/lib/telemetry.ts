/**
 * Anonymous usage reports, for deciding what to improve and fixing what breaks in browsers we cannot
 * test by hand: which pages are visited, how books come in, how labels go out, how a drag ended,
 * uncaught errors. No names, emails, addresses, book titles or other content. Each report carries a
 * random visitor id (kept in this browser beside the labels, and in backups) and a random id for the
 * tab, so a visit's steps and a returning visitor can be told apart. The Worker (worker/telemetry.ts)
 * writes them to Workers Analytics Engine; drag and error reports also to Workers Logs. Off in tests and
 * local development, unless forced. The event names and their fields are in lib/usage.ts.
 */

import type { EVENTS, EventName } from './usage';
import { BUILD_ID } from './updates';

export type TelemetryValue = string | number | boolean | null;
export type TelemetryData = Record<string, TelemetryValue>;

/** The fields an event takes, from lib/usage.ts. */
type FieldsOf<E extends EventName> = (typeof EVENTS)[E]['text'][number] | (typeof EVENTS)[E]['num'][number];

const ENDPOINT = '/api/t';
/** A page sends at most this many, so a loop gone wrong cannot flood the reports. */
const MAX_PER_PAGE = 150;
let sent = 0;

/** Which deploy the page is running. */
const build = BUILD_ID;

/** Kept beside the app's saved labels (lib/storage.ts), and in backups (lib/backup.ts). */
const VISITOR_KEY = 'mini-book-labels:visitor';
const SESSION_KEY = 'mini-book-labels:session';

export interface Visitor {
  /** Random: names nothing and no one. */
  id: string;
  /** The day of the first visit, yyyy-mm-dd. */
  first: string;
  visits: number;
}

const ID = /^[a-z0-9-]{8,40}$/;
const today = () => new Date().toISOString().slice(0, 10);
const randomId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export const isVisitor = (v: unknown): v is Visitor =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Visitor).id === 'string' &&
  ID.test((v as Visitor).id) &&
  typeof (v as Visitor).first === 'string' &&
  typeof (v as Visitor).visits === 'number';

let visitor: Visitor | null = null;

function saveVisitor(v: Visitor) {
  try {
    localStorage.setItem(VISITOR_KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the id lasts this page */
  }
}

/** This browser's visitor: from storage, or a new one. */
export function currentVisitor(): Visitor {
  if (visitor) return visitor;
  try {
    const saved = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? 'null');
    if (isVisitor(saved)) visitor = saved;
  } catch {
    /* none, or unreadable */
  }
  if (!visitor) {
    visitor = { id: randomId(), first: today(), visits: 0 };
    saveVisitor(visitor);
  }
  return visitor;
}

/** A restored backup brings its visitor with it, so moving to another browser is not a new visitor. */
export function adoptVisitor(v: unknown) {
  if (!isVisitor(v)) return;
  const mine = currentVisitor();
  visitor = v.id === mine.id ? mine : { id: v.id, first: v.first < mine.first ? v.first : mine.first, visits: v.visits + mine.visits };
  saveVisitor(visitor);
}

/** Random per tab: the steps of one visit share it. */
function session(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id || !ID.test(id)) {
      id = randomId();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return (sessionFallback ??= randomId());
  }
}
let sessionFallback: string | undefined;

/** Which page this is, by name. */
export function pageName(path = location.pathname): string {
  const name = path.replace(/^\/+|\/+$/g, '').split('/')[0];
  return name || 'app';
}

/** localStorage telemetry = 'force' turns it on anyway, to see the reports locally or check them in a test. */
const forced = () => {
  try {
    return localStorage.getItem('telemetry') === 'force';
  } catch {
    return false;
  }
};

const enabled = () =>
  typeof navigator !== 'undefined' &&
  (forced() || (!navigator.webdriver && !['localhost', '127.0.0.1'].includes(location.hostname)));

/** Sends one report. Fields are the event's own, from lib/usage.ts. */
export function track<E extends EventName>(event: E, data: Partial<Record<FieldsOf<E>, TelemetryValue>> = {}) {
  if (!enabled() || sent >= MAX_PER_PAGE) return;
  sent++;
  const v = currentVisitor();
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const body = JSON.stringify({
    event,
    build,
    data: {
      ...data,
      visitor: v.id,
      session: session(),
      page: pageName(),
      returning: v.visits > 1,
      platform: uaData?.platform ?? navigator.platform ?? '',
      vw: innerWidth,
      vh: innerHeight,
      dpr: devicePixelRatio,
      coarse: matchMedia('(pointer: coarse)').matches,
    },
  });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.(ENDPOINT, blob)) return;
    void fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
      () => {},
    );
  } catch {
    /* telemetry never gets in the way */
  }
}

/** Where a visit came from: a campaign, another site, another page of this one, or nowhere. */
export function visitSource(search: string, referrer: string, host: string): { source: string; referrer: string } {
  const campaign = new URLSearchParams(search).get('utm_source');
  if (campaign) return { source: `campaign:${campaign.slice(0, 40)}`, referrer: '' };
  if (!referrer) return { source: 'direct', referrer: '' };
  try {
    const url = new URL(referrer);
    if (url.hostname === host) return { source: 'internal', referrer: pageName(url.pathname) };
    return { source: 'site', referrer: url.hostname.replace(/^www\./, '') };
  } catch {
    return { source: 'direct', referrer: '' };
  }
}

/** Counts this page load and reports the visit. Once per page. */
export function trackVisit() {
  const v = currentVisitor();
  v.visits++;
  saveVisitor(v);
  const days = Math.round((Date.parse(today()) - Date.parse(v.first)) / 86_400_000);
  track('visit', { ...visitSource(location.search, document.referrer, location.hostname), visits: v.visits, daysSinceFirst: days });
}

/** Anything in quotes blanked: messages quote book titles, which never leave the browser. */
export const scrub = (message: string) => message.replace(/"[^"]*"|“[^”]*”/g, '"…"');

/** Reports uncaught errors, a few per page: a script error mid-drag is one way a drag silently fails. */
export function trackErrors() {
  let errors = 0;
  const report = (message: string, where: string) => {
    if (errors++ < 5) track('error', { message: scrub(message).slice(0, 160), where: where.slice(0, 160) });
  };
  addEventListener('error', (e) => report(String(e.message), `${e.filename?.split('/').pop() ?? ''}:${e.lineno}:${e.colno}`));
  addEventListener('unhandledrejection', (e) => report(String(e.reason?.message ?? e.reason), 'promise'));
}
