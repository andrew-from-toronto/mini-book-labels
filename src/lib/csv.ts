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

export function parseStoryGraphCsv(text: string): Book[] {
  const { data, meta } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (!meta.fields?.includes('title')) {
    throw new Error(
      `No "Title" column found. Is this a StoryGraph export? Columns seen: ${meta.fields?.join(', ') || 'none'}`,
    );
  }
  return data
    .filter((row) => row.title?.trim())
    .map((row, i) => {
      const rating = parseFloat(pick(row, 'star rating', 'rating', 'my rating'));
      return {
        id: String(i),
        title: row.title.trim(),
        authors: pick(row, 'authors', 'author'),
        isbn: parseIsbn(pick(row, 'isbn/uid', 'isbn13', 'isbn')),
        status: pick(row, 'read status', 'status').toLowerCase().replace(/\s+/g, '-') || 'unknown',
        rating: Number.isFinite(rating) ? rating : null,
        lastRead: latestDate(row['last date read'], row['dates read']),
      };
    });
}
