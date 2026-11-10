import { describe, expect, it } from 'vitest';
import { parseIsbn, parseStoryGraphCsv } from './csv';

const CSV = `Title,Authors,ISBN/UID,Read Status,Last Date Read,Dates Read,Star Rating
"Piranesi",Susanna Clarke,978-1-63557-563-3,read,2024/03/09,2024/03/01-2024/03/09,4.75
"Dune (Dune #1)","Frank Herbert, Someone Else",b1c2-uid,to-read,,,
,,,,,,
"Reread",A. Writer,0441172717,Read,,"2020/01/05-2020/01/09, 2023/6/2-2023/6/20",3
`;

describe('parseStoryGraphCsv', () => {
  const books = parseStoryGraphCsv(CSV);

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
    expect(() => parseStoryGraphCsv('a,b\n1,2\n')).toThrow(/Title/);
  });
});

describe('parseIsbn', () => {
  it('accepts ISBN-10 with X check digit', () => expect(parseIsbn('0-8044-2957-x')).toBe('080442957X'));
  it('rejects other lengths', () => expect(parseIsbn('12345')).toBeNull());
});
