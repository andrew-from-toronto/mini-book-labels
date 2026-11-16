import type { Book, Filters } from './types';

const byDateDesc = (a: Book, b: Book) => (b.lastRead ?? '').localeCompare(a.lastRead ?? '');

export function applyFilters(books: Book[], f: Filters): Book[] {
  const kept = books.filter(
    (b) =>
      (f.statuses.length === 0 || f.statuses.includes(b.status)) &&
      (f.minRating <= 0 || (b.rating !== null && b.rating >= f.minRating)) &&
      (!f.from || (b.lastRead !== null && b.lastRead >= f.from)) &&
      (!f.to || (b.lastRead !== null && b.lastRead <= f.to)),
  );
  const sorted = kept.sort((a, b) => {
    if (f.sort === 'title') return a.title.localeCompare(b.title);
    if (f.sort === 'rating') return (b.rating ?? -1) - (a.rating ?? -1) || byDateDesc(a, b);
    return byDateDesc(a, b);
  });
  return sorted.slice(0, Math.max(0, f.count));
}

/** `overrides[id]` true forces a book in, false ticks it off. */
export function selectBooks(books: Book[], top: Book[], overrides: Record<string, boolean>) {
  const inTop = new Set(top.map((b) => b.id));
  const listed = [...top, ...books.filter((b) => overrides[b.id] === true && !inTop.has(b.id))];
  return { listed, selected: listed.filter((b) => overrides[b.id] !== false) };
}

/**
 * Puts books in a hand-set order: those in `order` first, as ordered there, then the rest as they came.
 * Ids no longer listed are skipped, so an old order still works after the filters change.
 */
export function applyOrder(listed: Book[], order: string[]): Book[] {
  if (order.length === 0) return listed;
  const rank = new Map(order.map((id, i) => [id, i]));
  const ranked = listed.filter((b) => rank.has(b.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...ranked, ...listed.filter((b) => !rank.has(b.id))];
}

/** The order after moving book `id` to `to` (an index into `listed`), as the full list of ids. */
export function moveBook(listed: Book[], id: string, to: number): string[] {
  const ids = listed.map((b) => b.id).filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
  return ids;
}
