import { describe, expect, it } from 'vitest';
import { applyFilters, applyOrder, moveBook, selectBooks } from './filter';
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

describe('applyOrder', () => {
  it('puts ordered books first, in that order, then the rest as they came', () => {
    expect(ids(applyOrder(books, ['d', 'b']))).toBe('dbace');
  });

  it('skips ids that are no longer listed and leaves an empty order alone', () => {
    expect(ids(applyOrder(books.slice(0, 3), ['z', 'c', 'a']))).toBe('cab');
    expect(applyOrder(books, [])).toBe(books);
  });
});

describe('moveBook', () => {
  it('moves a book to a new position', () => {
    expect(moveBook(books, 'a', 2).join('')).toBe('bcade');
    expect(moveBook(books, 'e', 0).join('')).toBe('eabcd');
  });

  it('clamps positions past either end', () => {
    expect(moveBook(books, 'c', -1).join('')).toBe('cabde');
    expect(moveBook(books, 'c', 99).join('')).toBe('abdec');
  });
});
