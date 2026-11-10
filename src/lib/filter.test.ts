import { describe, expect, it } from 'vitest';
import { applyFilters, selectBooks } from './filter';
import type { Book, Filters } from './types';

const book = (id: string, patch: Partial<Book> = {}): Book => ({
  id,
  title: `Book ${id}`,
  authors: 'Someone',
  isbn: null,
  status: 'read',
  rating: null,
  lastRead: null,
  ...patch,
});

const books = [
  book('a', { rating: 5, lastRead: '2024-02-01' }),
  book('b', { rating: 3.5, lastRead: '2025-06-01' }),
  book('c', { rating: 5, lastRead: '2025-01-15' }),
  book('d', { status: 'to-read' }),
  book('e'),
];

const base: Filters = { statuses: ['read'], minRating: 0, from: '', to: '', sort: 'rating', count: 10 };
const ids = (list: Book[]) => list.map((b) => b.id).join('');

describe('applyFilters', () => {
  it('filters by status and sorts by rating, newest first on ties, unrated last', () => {
    expect(ids(applyFilters(books, base))).toBe('cabe');
  });

  it('drops unrated books once a minimum rating is set', () => {
    expect(ids(applyFilters(books, { ...base, minRating: 4 }))).toBe('ca');
  });

  it('drops undated books once a date range is set', () => {
    expect(ids(applyFilters(books, { ...base, from: '2025-01-01', to: '2025-12-31' }))).toBe('cb');
  });

  it('takes the top N after sorting', () => {
    expect(ids(applyFilters(books, { ...base, sort: 'date-read', count: 2 }))).toBe('bc');
  });

  it('does not reorder the input array', () => {
    applyFilters(books, { ...base, sort: 'title' });
    expect(ids(books)).toBe('abcde');
  });
});

describe('selectBooks', () => {
  it('applies manual ticks on top of the filtered list', () => {
    const top = applyFilters(books, { ...base, count: 2 });
    const { listed, selected } = selectBooks(books, top, { c: false, d: true });
    expect(ids(listed)).toBe('cad');
    expect(ids(selected)).toBe('ad');
  });
});
