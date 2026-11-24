/**
 * Usage events: what the pages send (lib/telemetry.ts), what the Worker writes to Workers Analytics Engine
 * (worker/telemetry.ts), and what admin reads back (worker/usage.ts). One table, so all three agree on
 * which column holds what.
 *
 * Every row: index1 the visitor (so sampling keeps a visitor's events together), then
 *   blob1 event, blob2 visitor, blob3 session, blob4 page, blob5 build, blob6 device, blob7 browser,
 *   blob8 country, blob9 new or returning;
 * the event's own text fields in blob10 to blob20, its numbers in double1 to double20, in the order below.
 *
 * Nothing here is personal: no book titles, names, emails or addresses. The visitor id is random, kept
 * with the labels in the browser (and in backups); the session id is random per tab.
 */

export interface EventShape {
  text: readonly string[];
  num: readonly string[];
}

export const EVENTS = {
  /** A page opened. source: campaign, referring site, internal, or direct. */
  visit: { text: ['source', 'referrer'], num: ['visits', 'daysSinceFirst'] },
  /** Books loaded. how: storygraph, goodreads, sample, backup. */
  library: { text: ['how'], num: ['books'] },
  /** A book added by hand. how: search, blank. */
  'book-added': { text: ['how'], num: [] },
  /** A book search run. found: yes or no. */
  search: { text: ['found'], num: ['results'] },
  /** A cover changed. how: edition, upload, link, wrap, spine, crop, reset. */
  cover: { text: ['how'], num: [] },
  /** A preview shown. view: sheet, 3d, tree, expanded. */
  view: { text: ['view'], num: [] },
  /** Labels sent somewhere: the north star. mode: home, shop, cricut, silhouette. ok: yes, no. */
  output: {
    text: ['mode', 'ok', 'scale', 'back', 'style', 'preset', 'colour', 'cut', 'error'],
    num: ['labels', 'sheets', 'ms', 'found', 'generated', 'replaced'],
  },
  /** The free 3D model downloaded. */
  'model-download': { text: ['format', 'scale', 'hook'], num: [] },
  /** The shop. step: page, checkout, paid (paid is written by the Worker). */
  order: { text: ['step', 'scale', 'source'], num: ['quantity', 'amount'] },
  /** Tips. step: opened, paid. */
  coffee: { text: ['step'], num: ['amount'] },
  /** action: backup, restore, start-over. */
  data: { text: ['action'], num: ['books'] },
  /** A feedback message sent (its text goes to the database, not here). */
  feedback: { text: ['withEmail'], num: ['length'] },
  /** How a drag ended (components/useDragOrder.ts). */
  drag: { text: ['outcome', 'pointer', 'scroller', 'captured'], num: ['ms', 'moves', 'dist', 'hits', 'slot', 'from', 'books'] },
  /** An uncaught script error. */
  error: { text: ['message', 'where'], num: [] },
} as const satisfies Record<string, EventShape>;

export type EventName = keyof typeof EVENTS;

export const isEvent = (name: string): name is EventName => Object.hasOwn(EVENTS, name);

/** The fixed columns before an event's own. */
export const COMMON_BLOBS = ['event', 'visitor', 'session', 'page', 'build', 'device', 'browser', 'country', 'returning'] as const;

/** The Analytics Engine column an event's field is stored in, e.g. "blob11" or "double2". */
export function columnOf(event: EventName, field: string): string | null {
  const shape: EventShape = EVENTS[event];
  const t = shape.text.indexOf(field);
  if (t >= 0) return `blob${COMMON_BLOBS.length + 1 + t}`;
  const n = shape.num.indexOf(field);
  return n >= 0 ? `double${n + 1}` : null;
}
