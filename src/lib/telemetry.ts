/**
 * Anonymous reports of how things went, for fixing what breaks in browsers we cannot test by hand:
 * how a drag ended, uncaught errors. No ids, no cookies, no book titles or other content. The Worker
 * (worker/telemetry.ts) writes each one to Workers Logs. Off in tests and local development, unless forced.
 */

import { BUILD_ID } from './updates';

export type TelemetryData = Record<string, string | number | boolean | null>;

const ENDPOINT = '/api/t';
/** A page sends at most this many, so a loop gone wrong cannot flood the logs. */
const MAX_PER_PAGE = 40;
let sent = 0;

/** Which deploy the page is running. */
const build = BUILD_ID;

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

export function track(event: string, data: TelemetryData = {}) {
  if (!enabled() || sent >= MAX_PER_PAGE) return;
  sent++;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const body = JSON.stringify({
    event,
    build,
    data: {
      ...data,
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

/** Reports uncaught errors, a few per page: a script error mid-drag is one way a drag silently fails. */
export function trackErrors() {
  let errors = 0;
  const report = (message: string, where: string) => {
    if (errors++ < 5) track('error', { message: message.slice(0, 160), where: where.slice(0, 160) });
  };
  addEventListener('error', (e) => report(String(e.message), `${e.filename?.split('/').pop() ?? ''}:${e.lineno}:${e.colno}`));
  addEventListener('unhandledrejection', (e) => report(String(e.reason?.message ?? e.reason), 'promise'));
}
