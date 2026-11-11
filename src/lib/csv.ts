import Papa from 'papaparse';
import type { Book } from './types';

const DATE = /\d{4}[/-]\d{1,2}[/-]\d{1,2}/g;

function latestDate(...cells: (string | undefined)[]): string | null {
  const found = cells
    .flatMap((c) => c?.match(DATE) ?? [])
    .map((d) => {
      const [y, m, day] = d.split(/[/-]/);
      return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
    })
    .sort();
  return found.at(-1) ?? null;
}

export function parseIsbn(cell: string | undefined): string | null {
  const v = (cell ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^(\d{13}|\d{9}[\dX])$/.test(v) ? v : null;
}

function pick(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) if (row[n]?.trim()) return row[n].trim();
  return '';
}

export type LibrarySource = 'storygraph' | 'goodreads';

/** Goodreads exports carry these columns; StoryGraph exports do not. */
function detectSource(fields: string[]): LibrarySource {
  return fields.includes('exclusive shelf') || fields.includes('my rating') ? 'goodreads' : 'storygraph';
}

/** Goodreads wraps ISBNs as ="0441172717" so spreadsheets keep leading zeros. */
function unwrapExcel(cell: string): string {
  return cell.replace(/^="?|"$/g, '');
}

function fromStoryGraph(row: Record<string, string>): Omit<Book, 'id'> {
  const rating = parseFloat(pick(row, 'star rating', 'rating', 'my rating'));
  return {
    title: row.title.trim(),
    authors: pick(row, 'authors', 'author'),
    isbn: parseIsbn(pick(row, 'isbn/uid', 'isbn13', 'isbn')),
    status: pick(row, 'read status', 'status').toLowerCase().replace(/\s+/g, '-') || 'unknown',
    rating: Number.isFinite(rating) ? rating : null,
    lastRead: latestDate(row['last date read'], row['dates read']),
  };
}

function fromGoodreads(row: Record<string, string>): Omit<Book, 'id'> {
  // Whole stars, with 0 meaning the book was never rated.
  const rating = parseInt(pick(row, 'my rating'), 10);
  return {
    title: row.title.trim(),
    authors: [pick(row, 'author'), pick(row, 'additional authors')].filter(Boolean).join(', '),
    isbn: parseIsbn(unwrapExcel(pick(row, 'isbn13'))) ?? parseIsbn(unwrapExcel(pick(row, 'isbn'))),
    status: pick(row, 'exclusive shelf').toLowerCase().replace(/\s+/g, '-') || 'unknown',
    rating: rating > 0 ? rating : null,
    lastRead: latestDate(row['date read']),
  };
}

/** Parses a StoryGraph or Goodreads library export, telling them apart by their columns. */
export function parseLibraryCsv(text: string): { source: LibrarySource; books: Book[] } {
  const { data, meta } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = meta.fields ?? [];
  if (!fields.includes('title')) {
    throw new Error(
      `No "Title" column found. Is this a StoryGraph or Goodreads export? Columns seen: ${fields.join(', ') || 'none'}`,
    );
  }
  const source = detectSource(fields);
  const map = source === 'goodreads' ? fromGoodreads : fromStoryGraph;
  const books = data.filter((row) => row.title?.trim()).map((row, i) => ({ id: String(i), ...map(row) }));
  return { source, books };
}
