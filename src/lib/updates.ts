/**
 * Keeps an open tab from running an old copy of the site for days. Each build writes /version.json with
 * its id (vite.config.ts); this page knows its own id, checks the file when the tab comes back into view
 * and every so often while it stays open, and when a newer build is out offers a Reload. Never reloads
 * on its own: there may be unsaved work, or a payment half done.
 *
 * An old tab keeps working meanwhile: every page loads all of its parts as soon as it opens
 * (src/lib/preload.ts), so none are left to fetch after a deploy has replaced them.
 */

declare const __BUILD_ID__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const CHECK_EVERY_MS = 15 * 60 * 1000;
/** Coming back to the tab checks at most this often. */
const MIN_GAP_MS = 60 * 1000;

let lastCheck = 0;
let shown = false;

async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: { build?: unknown } = await res.json();
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}

/** Looks for a newer build and offers it. `now` skips the wait between looks. */
export async function checkForUpdate(now = false) {
  if (shown || document.visibilityState !== 'visible' || (!now && Date.now() - lastCheck < MIN_GAP_MS)) return;
  lastCheck = Date.now();
  const latest = await latestBuild();
  if (latest && latest !== BUILD_ID && (BUILD_ID !== 'dev' || forced())) showBanner('Mini Book Labels has been updated. Reload to get the latest version.');
}

/** A small bar at the bottom of the page, styled inline so it works on every page whatever its CSS. */
function showBanner(message: string) {
  if (shown) return;
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.setAttribute('role', 'status');
  Object.assign(bar.style, {
    position: 'fixed',
    left: '16px',
    right: '16px',
    bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
    margin: '0 auto',
    maxWidth: '480px',
    zIndex: '2147483000',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 10px 10px 16px',
    borderRadius: '10px',
    background: '#2b2824',
    color: '#f6f2ea',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.3)',
    font: '15px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);

  const text = document.createElement('span');
  text.textContent = message;
  text.style.flex = '1';

  const button = (label: string, primary: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      flex: 'none',
      minHeight: '40px',
      padding: '0 14px',
      border: primary ? '0' : '1px solid rgb(246 242 234 / 0.35)',
      borderRadius: '8px',
      background: primary ? '#f6f2ea' : 'transparent',
      color: primary ? '#2b2824' : '#f6f2ea',
      font: 'inherit',
      fontWeight: primary ? '600' : '400',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    return b;
  };
  const reload = button('Reload', true);
  // The app saves its state a moment after each change; give that time to land first.
  reload.addEventListener('click', () => setTimeout(() => location.reload(), 400));
  const later = button('Later', false);
  later.addEventListener('click', () => {
    bar.remove();
    // Ask again next time something new is noticed, not straight away.
    shown = false;
    lastCheck = Date.now() + CHECK_EVERY_MS;
  });

  bar.append(text, reload, later);
  // Above anything pinned to the bottom of the screen, like the app's tab bar on phones.
  const pinned = [...document.querySelectorAll<HTMLElement>('nav')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top > innerHeight / 2 && Math.abs(r.bottom - innerHeight) <= 1;
  });
  const lift = Math.max(0, ...pinned.map((el) => innerHeight - el.getBoundingClientRect().top));
  if (lift) bar.style.bottom = `${lift + 12}px`;
  document.body.append(bar);
}

/** localStorage updates = 'force' checks in development too, against whatever /version.json says (for tests). */
const forced = () => {
  try {
    return localStorage.getItem('updates') === 'force';
  } catch {
    return false;
  }
};

/** Starts watching for new builds. Does nothing in development, where there is no version.json. */
export function watchForUpdates() {
  if (BUILD_ID === 'dev' && !forced()) return;
  document.addEventListener('visibilitychange', () => void checkForUpdate());
  addEventListener('focus', () => void checkForUpdate());
  // Coming back with the back button can show a page from before a deploy without loading it again.
  addEventListener('pageshow', (e) => e.persisted && void checkForUpdate());
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
