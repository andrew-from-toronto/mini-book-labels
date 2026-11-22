/**
 * Label redraws, spread over animation frames so dragging a slider stays smooth with many labels
 * showing. Each frame draws what it can in a few milliseconds and leaves the rest for the next. A newer
 * request for the same target replaces its older one, so only the latest look is ever drawn.
 *
 * Full print-resolution drawing waits until edits pause (`scheduleFinal`); printing draws anything still
 * waiting at once, so a sheet is never printed from preview-resolution labels.
 */

type Job = () => void;

/** Milliseconds of drawing per frame before the rest wait for the next one. */
const BUDGET_MS = 8;

const pending = new Map<unknown, Job>();
const finals = new Map<unknown, { job: Job; timer: ReturnType<typeof setTimeout> }>();
let frame = 0;

function run() {
  frame = 0;
  const start = performance.now();
  for (const [key, job] of pending) {
    pending.delete(key);
    job();
    if (performance.now() - start > BUDGET_MS) break;
  }
  if (pending.size) frame = requestAnimationFrame(run);
}

/** Draws `job` soon, in its turn; replaces anything still waiting for the same `key`. */
export function schedule(key: unknown, job: Job) {
  pending.set(key, job);
  if (!frame) frame = requestAnimationFrame(run);
}

/** Draws `job` once nothing has changed for `delay` ms (or at once when printing). */
export function scheduleFinal(key: unknown, job: Job, delay = 400) {
  cancelFinal(key);
  finals.set(key, {
    job,
    timer: setTimeout(() => {
      finals.delete(key);
      schedule(key, job);
    }, delay),
  });
}

/** Forgets anything waiting for `key` (its label has gone, or changed again). */
export function cancel(key: unknown) {
  pending.delete(key);
  cancelFinal(key);
}

function cancelFinal(key: unknown) {
  const f = finals.get(key);
  if (!f) return;
  clearTimeout(f.timer);
  finals.delete(key);
}

/** Draws everything waiting, now: the sheet is about to print. */
export function flushAll() {
  for (const [key, f] of finals) {
    clearTimeout(f.timer);
    finals.delete(key);
    pending.set(key, f.job);
  }
  for (const [key, job] of pending) {
    pending.delete(key);
    job();
  }
}

if (typeof window !== 'undefined') window.addEventListener('beforeprint', flushAll);
