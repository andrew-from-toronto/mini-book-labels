import { describe, expect, it } from 'vitest';
import { parseIsbn } from './csv';
import { isSample, SAMPLE_BOOKS, sampleLibrary } from './sample';

/** Deterministic stand-in for Math.random. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

describe('SAMPLE_BOOKS', () => {
  it('has valid, unique ISBNs', () => {
    const isbns = SAMPLE_BOOKS.map((b) => b.isbn);
    expect(isbns.every((i) => parseIsbn(i) === i)).toBe(true);
    expect(new Set(isbns).size).toBe(isbns.length);
  });
});

describe('sampleLibrary', () => {
  const today = new Date('2026-11-10T12:00:00Z');
  // A full Letter sheet at 1:7 holds 28 labels.
  const books = sampleLibrary(28, 4, seeded(1), today);

  it('picks distinct books: the requested number read, then the unread extras', () => {
    expect(books).toHaveLength(32);
    expect(new Set(books.map((b) => b.id)).size).toBe(32);
    expect(books.filter((b) => b.status === 'read')).toHaveLength(28);
    expect(books.slice(28).every((b) => b.status !== 'read')).toBe(true);
    expect(isSample(books)).toBe(true);
  });

  it('caps at the size of the list', () => {
    const all = sampleLibrary(500, 4, seeded(3), today);
    expect(all).toHaveLength(SAMPLE_BOOKS.length);
    expect(all.every((b) => b.status === 'read')).toBe(true);
  });

  it('gives read books a rating and a date in the last three years, and others neither', () => {
    for (const b of books) {
      if (b.status === 'read') {
        expect(b.rating).toBeGreaterThanOrEqual(2.5);
        expect(b.rating).toBeLessThanOrEqual(5);
        expect((b.rating! * 4) % 1).toBe(0);
        expect(b.lastRead! >= '2023-11-10' && b.lastRead! <= '2026-11-10').toBe(true);
      } else {
        expect(b).toMatchObject({ rating: null, lastRead: null });
      }
    }
  });

  it('varies with the random source', () => {
    const other = sampleLibrary(28, 4, seeded(2), today);
    expect(other.map((b) => b.id)).not.toEqual(books.map((b) => b.id));
  });

  it('is not mistaken for a real library', () => {
    expect(isSample([])).toBe(false);
    expect(isSample([...books, { ...books[0], id: '0' }])).toBe(false);
  });
});

describe('a sample at 1:7 on Letter', () => {
  it('has enough books to fill the 28-label sheet', async () => {
    const { gridFor } = await import('./layout');
    const { dimsAtScale } = await import('./scales');
    const settings = {
      ...dimsAtScale(7),
      style: 'edge',
      paper: 'letter',
      margin: 10,
      gap: 2,
      guideOpacity: 1,
      guideWidth: 0.15,
      model: { hook: false, hookPosition: 'center', roundSpine: false },
    } as const;
    const { perPage } = gridFor(settings);
    expect(perPage).toBe(28);
    expect(sampleLibrary(perPage).filter((b) => b.status === 'read')).toHaveLength(28);
  });
});
