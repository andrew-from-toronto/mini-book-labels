import { describe, expect, it } from 'vitest';
import { parseIsbn, parseLibraryCsv } from './csv';

const CSV = `Title,Authors,ISBN/UID,Read Status,Last Date Read,Dates Read,Star Rating
"Piranesi",Susanna Clarke,978-1-63557-563-3,read,2024/03/09,2024/03/01-2024/03/09,4.75
"Dune (Dune #1)","Frank Herbert, Someone Else",b1c2-uid,to-read,,,
,,,,,,
"Reread",A. Writer,0441172717,Read,,"2020/01/05-2020/01/09, 2023/6/2-2023/6/20",3
`;

describe('parseLibraryCsv with a StoryGraph export', () => {
  const { source, books } = parseLibraryCsv(CSV);

  it('detects StoryGraph', () => expect(source).toBe('storygraph'));

  it('maps columns and skips rows without a title', () => {
    expect(books).toHaveLength(3);
    expect(books[0]).toMatchObject({
      title: 'Piranesi',
      authors: 'Susanna Clarke',
      isbn: '9781635575633',
      status: 'read',
      rating: 4.75,
      lastRead: '2024-03-09',
    });
  });

  it('treats non-ISBN UIDs and blank ratings as missing', () => {
    expect(books[1]).toMatchObject({ isbn: null, rating: null, lastRead: null, status: 'to-read' });
  });

  it('takes the latest date across read ranges and normalises status case', () => {
    expect(books[2]).toMatchObject({ lastRead: '2023-06-20', status: 'read', isbn: '0441172717' });
  });

  it('rejects files without a Title column', () => {
    expect(() => parseLibraryCsv('a,b\n1,2\n')).toThrow(/Title/);
  });
});

const GOODREADS = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies
234225,"Dune (Dune, #1)",Frank Herbert,"Herbert, Frank",,"=""0441172717""","=""9780441172719""",5,4.27,Ace,Paperback,604,1990,1965,2023/06/20,2023/01/02,,,read,,,,1,0
2,Untitled Thing,A. Writer,"Writer, A.","B. Helper, C. Helper","=""""","=""""",0,3.9,,,,,,,2024/01/01,to-read,to-read (#1),to-read,,,,0,0
3,No ISBN13,C. Writer,"Writer, C.",,"=""080442957X""","=""""",3,3.1,,,,,,,2024/01/01,,,currently-reading,,,,0,0
`;

describe('parseLibraryCsv with a Goodreads export', () => {
  const { source, books } = parseLibraryCsv(GOODREADS);

  it('detects Goodreads', () => expect(source).toBe('goodreads'));

  it('maps columns and unwraps ="..." ISBNs, preferring ISBN13', () => {
    expect(books[0]).toMatchObject({
      title: 'Dune (Dune, #1)',
      authors: 'Frank Herbert',
      isbn: '9780441172719',
      status: 'read',
      rating: 5,
      lastRead: '2023-06-20',
    });
  });

  it('treats a 0 rating and empty ISBNs as missing and joins additional authors', () => {
    expect(books[1]).toMatchObject({
      authors: 'A. Writer, B. Helper, C. Helper',
      isbn: null,
      rating: null,
      lastRead: null,
      status: 'to-read',
    });
  });

  it('falls back to the 10-digit ISBN', () => {
    expect(books[2]).toMatchObject({ isbn: '080442957X', rating: 3, status: 'currently-reading' });
  });
});

describe('parseIsbn', () => {
  it('accepts ISBN-10 with X check digit', () => expect(parseIsbn('0-8044-2957-x')).toBe('080442957X'));
  it('rejects other lengths', () => expect(parseIsbn('12345')).toBeNull());
});
