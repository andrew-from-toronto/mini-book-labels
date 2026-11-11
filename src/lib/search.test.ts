import { describe, expect, it } from 'vitest';
import { parseSearchDocs, searchQueryUrl } from './search';

describe('parseSearchDocs', () => {
  it('maps Open Library docs and skips ones without a key or title', () => {
    expect(
      parseSearchDocs([
        {
          key: '/works/OL27448W',
          title: 'The Lord of the Rings',
          author_name: ['J.R.R. Tolkien'],
          first_publish_year: 1954,
          cover_i: 14625765,
          cover_edition_key: 'OL51711263M',
        },
        { key: '/works/OL1W', title: 'No cover', author_name: ['A', 'B', 'C', 'D'], cover_i: -1 },
        { title: 'No key' },
        { key: '/works/OL2W' },
      ]),
    ).toEqual([
      {
        key: '/works/OL27448W',
        title: 'The Lord of the Rings',
        authors: 'J.R.R. Tolkien',
        year: 1954,
        coverId: 14625765,
        coverEdition: 'OL51711263M',
      },
      { key: '/works/OL1W', title: 'No cover', authors: 'A, B, C', year: undefined, coverId: undefined, coverEdition: undefined },
    ]);
  });
});

describe('searchQueryUrl', () => {
  it('asks only for the fields the suggestions show', () => {
    const url = new URL(searchQueryUrl('  piranesi clarke '), 'https://minibookornaments.com');
    expect(url.pathname).toBe('/api/ol/search');
    expect(url.searchParams.get('q')).toBe('piranesi clarke');
    expect(url.searchParams.get('fields')).toBe('key,title,author_name,first_publish_year,cover_i,cover_edition_key');
    expect(url.searchParams.get('limit')).toBe('8');
  });
});
