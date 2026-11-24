/** Small helpers that turn app changes into usage events (lib/usage.ts). */
import { coverIdFromUrl } from './covers';
import type { CustomCover } from './types';

/** Spine and crop sliders fire on every move: each book's first adjustment of each per page is enough. */
const adjusted = new Set<string>();

/** How a cover changed, or null for a change not worth an event. */
export function coverChange(id: string, before: CustomCover | undefined, after: CustomCover | null): string | null {
  if (!after) return before ? 'reset' : null;
  if (!before || before.url !== after.url) {
    if (after.wrap) return 'wrap';
    if (after.url.startsWith('data:')) return 'upload';
    return coverIdFromUrl(after.url) ? 'edition' : 'link';
  }
  if (before.wrap !== after.wrap) return after.wrap ? 'wrap' : 'link';
  for (const part of ['spine', 'crop'] as const) {
    if (JSON.stringify(before[part]) !== JSON.stringify(after[part]) && !adjusted.has(`${part}:${id}`)) {
      adjusted.add(`${part}:${id}`);
      return part;
    }
  }
  return null;
}
