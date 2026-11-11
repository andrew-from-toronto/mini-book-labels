import { describe, expect, it } from 'vitest';
import { coverIdFromUrl, idCoverUrl, MAX_VARIANTS, pickVariants } from './covers';

describe('pickVariants', () => {
  const entries = [
    { covers: [10, -1], languages: [{ key: '/languages/spa' }], publish_date: 'May 2001' },
    { covers: [20], languages: [{ key: '/languages/eng' }], publish_date: '1999' },
    { covers: [30, 20] },
    { covers: [] },
    {},
  ];

  it('dedupes, drops removed covers, and puts English or unlabelled editions first, newest first', () => {
    expect(pickVariants(entries).map((v) => v.id)).toEqual([30, 20, 10]);
  });

  it('keeps the year and language', () => {
    expect(pickVariants(entries).find((v) => v.id === 10)).toEqual({ id: 10, year: '2001', english: false });
  });

  it('leads with the cover already in use', () => {
    expect(pickVariants(entries, 10).map((v) => v.id)).toEqual([10, 30, 20]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ covers: [i + 1] }));
    expect(pickVariants(many)).toHaveLength(MAX_VARIANTS);
  });
});

describe('coverIdFromUrl', () => {
  it('reads ids back from cover URLs', () => expect(coverIdFromUrl(idCoverUrl(12345))).toBe(12345));
  it('ignores other URLs', () => expect(coverIdFromUrl('https://example.com/a.jpg')).toBeNull());
  it('reads covers saved before they went through the Worker', () =>
    expect(coverIdFromUrl('https://covers.openlibrary.org/b/id/777-L.jpg?default=false')).toBe(777));
});
