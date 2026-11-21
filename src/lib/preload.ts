import { checkForUpdate } from './updates';

/**
 * Loads the parts of a page that are split off to keep its first paint quick (the 3D view, the geometry
 * engine, the coffee dialog), straight after the page itself has loaded rather than when first used.
 * Opening them later is then instant, and a deploy cannot take their files away from a tab already
 * open: every part of the page it runs is already in memory or the browser's cache.
 */
export function preloadAll(loaders: (() => Promise<unknown>)[]) {
  const run = () => {
    for (const load of loaders) {
      // Only fails if a deploy landed between the page loading and this: see if a new version is out.
      load().catch(() => void checkForUpdate(true));
    }
  };
  const whenIdle = () =>
    'requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 3000 }) : setTimeout(run, 500);
  if (document.readyState === 'complete') whenIdle();
  else addEventListener('load', whenIdle, { once: true });
}
