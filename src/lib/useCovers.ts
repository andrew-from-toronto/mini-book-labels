import { useEffect, useReducer } from 'react';
import { resolveCover, type CoverResult } from './covers';
import type { Book } from './types';

const results = new Map<string, CoverResult>();
const pending = new Set<string>();

const keyFor = (book: Book, custom?: string) => `${book.title}|${book.authors}|${book.isbn}|${custom ?? ''}`;

/** Returns a lookup that yields undefined while a book's cover is still loading. */
export function useCovers(books: Book[], customCovers: Record<string, string>) {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    for (const book of books) {
      const key = keyFor(book, customCovers[book.id]);
      if (results.has(key) || pending.has(key)) continue;
      pending.add(key);
      void resolveCover(book, customCovers[book.id]).then((result) => {
        results.set(key, result);
        pending.delete(key);
        bump();
      });
    }
  }, [books, customCovers]);

  return (book: Book) => results.get(keyFor(book, customCovers[book.id]));
}
