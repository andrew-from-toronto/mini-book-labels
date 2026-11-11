import type { Book } from './types';

/**
 * Well-known books whose ISBNs have covers on Open Library (checked November 2026), for trying the app
 * without a library export. Covers still load through the normal Open Library lookup. Each ISBN was picked
 * by eye for a clean publisher cover: photos of worn library copies (tilted, stickered, stamped) are avoided,
 * since they print badly on a label.
 */
export const SAMPLE_BOOKS: { title: string; authors: string; isbn: string }[] = [
  { title: 'Dune', authors: 'Frank Herbert', isbn: '9780441172719' },
  { title: 'The Hobbit', authors: 'J.R.R. Tolkien', isbn: '9780812415834' },
  { title: 'To Kill a Mockingbird', authors: 'Harper Lee', isbn: '9780061120084' },
  { title: '1984', authors: 'George Orwell', isbn: '9780451524935' },
  { title: 'The Great Gatsby', authors: 'F. Scott Fitzgerald', isbn: '9780743246392' },
  { title: 'Pride and Prejudice', authors: 'Jane Austen', isbn: '9780141439518' },
  { title: 'The Da Vinci Code', authors: 'Dan Brown', isbn: '9780307474278' },
  { title: "The Handmaid's Tale", authors: 'Margaret Atwood', isbn: '9781784708238' },
  { title: 'The Catcher in the Rye', authors: 'J.D. Salinger', isbn: '9780316769174' },
  { title: 'Brave New World', authors: 'Aldous Huxley', isbn: '9780060850524' },
  { title: 'A Brief History of Time', authors: 'Stephen Hawking', isbn: '9780857501004' },
  { title: "Harry Potter and the Sorcerer's Stone", authors: 'J.K. Rowling', isbn: '9780439708180' },
  { title: 'The Lord of the Rings', authors: 'J.R.R. Tolkien', isbn: '9780544003415' },
  { title: "The Hitchhiker's Guide to the Galaxy", authors: 'Douglas Adams', isbn: '9780345391803' },
  { title: 'Sapiens', authors: 'Yuval Noah Harari', isbn: '9780062316097' },
  { title: 'The Midnight Library', authors: 'Matt Haig', isbn: '9780525559474' },
  { title: 'The Silent Patient', authors: 'Alex Michaelides', isbn: '9781250301697' },
  { title: 'Project Hail Mary', authors: 'Andy Weir', isbn: '9780593135204' },
  { title: 'Piranesi', authors: 'Susanna Clarke', isbn: '9781635575637' },
  { title: 'The Road', authors: 'Cormac McCarthy', isbn: '9780307387899' },
  { title: 'Everything I Never Told You', authors: 'Celeste Ng', isbn: '9780143127550' },
  { title: 'When Breath Becomes Air', authors: 'Paul Kalanithi', isbn: '9780812988406' },
  { title: 'Where the Crawdads Sing', authors: 'Delia Owens', isbn: '9780735219090' },
  { title: 'The Maze Runner', authors: 'James Dashner', isbn: '9780385737951' },
  { title: 'Crime and Punishment', authors: 'Fyodor Dostoevsky', isbn: '9781435131828' },
  { title: 'The Way of Kings', authors: 'Brandon Sanderson', isbn: '9780765326355' },
  { title: 'The Seven Husbands of Evelyn Hugo', authors: 'Taylor Jenkins Reid', isbn: '9781501161933' },
  { title: 'Thinking, Fast and Slow', authors: 'Daniel Kahneman', isbn: '9780374533557' },
  { title: 'The Martian', authors: 'Andy Weir', isbn: '9780553418026' },
  { title: 'Circe', authors: 'Madeline Miller', isbn: '9780316556347' },
  { title: 'The 7 Habits of Highly Effective People', authors: 'Stephen R. Covey', isbn: '9781982137274' },
  { title: 'Atomic Habits', authors: 'James Clear', isbn: '9780735211292' },
  { title: 'Normal People', authors: 'Sally Rooney', isbn: '9780735276499' },
  { title: 'Harry Potter and the Chamber of Secrets', authors: 'J.K. Rowling', isbn: '9781551927282' },
  { title: 'Harry Potter and the Goblet of Fire', authors: 'J.K. Rowling', isbn: '9780439139601' },
  { title: 'And Then There Were None', authors: 'Agatha Christie', isbn: '9780671754013' },
  { title: 'The Fault in Our Stars', authors: 'John Green', isbn: '9780142424179' },
  { title: 'Gone Girl', authors: 'Gillian Flynn', isbn: '9780307588371' },
  { title: 'The Brothers Karamazov', authors: 'Fyodor Dostoevsky', isbn: '9780374528379' },
  { title: 'The Stranger', authors: 'Albert Camus', isbn: '9780679720201' },
  { title: 'One Hundred Years of Solitude', authors: 'Gabriel Garcia Marquez', isbn: '9780060883287' },
  { title: 'Beloved', authors: 'Toni Morrison', isbn: '9781400033416' },
  { title: 'Twilight', authors: 'Stephenie Meyer', isbn: '9780316015844' },
  { title: 'Mistborn', authors: 'Brandon Sanderson', isbn: '9780765311788' },
  { title: 'A Game of Thrones', authors: 'George R.R. Martin', isbn: '9780553593716' },
  { title: 'The Kite Runner', authors: 'Khaled Hosseini', isbn: '9781594631931' },
  { title: 'The Left Hand of Darkness', authors: 'Ursula K. Le Guin', isbn: '9780143111597' },
  { title: 'Little Fires Everywhere', authors: 'Celeste Ng', isbn: '9780735224292' },
  { title: 'Lord of the Flies', authors: 'William Golding', isbn: '9780571056866' },
  { title: "Ender's Game", authors: 'Orson Scott Card', isbn: '9780812550702' },
  { title: 'How to Win Friends and Influence People', authors: 'Dale Carnegie', isbn: '9780671027032' },
  { title: 'Angels & Demons', authors: 'Dan Brown', isbn: '9781416524793' },
  { title: 'The Little Prince', authors: 'Antoine de Saint-Exupery', isbn: '9780156012195' },
];

/** Books in a sample that are not marked read, so the read-status filter has something to hide. */
export const SAMPLE_UNREAD = 4;
/** Ids of sample books start with this, so the app can tell a sample library from a real one. */
export const SAMPLE_PREFIX = 'sample-';

export const isSample = (books: Book[]) => books.length > 0 && books.every((b) => b.id.startsWith(SAMPLE_PREFIX));

/**
 * A random set of the sample books: `read` of them read, with quarter-star ratings and dates over the
 * last three years, plus `unread` currently reading or still to read. Pass the labels per page as
 * `read` to fill a sheet. Both are capped by the size of the list, read books first.
 */
export function sampleLibrary(
  read: number,
  unread = SAMPLE_UNREAD,
  random: () => number = Math.random,
  today = new Date(),
): Book[] {
  const pool = [...SAMPLE_BOOKS];
  // Fisher-Yates, then take from the front.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const readCount = Math.min(read, pool.length);
  return pool.slice(0, readCount + unread).map((b, i): Book => {
    const base = { id: `${SAMPLE_PREFIX}${b.isbn}`, title: b.title, authors: b.authors, isbn: b.isbn };
    if (i >= readCount) {
      return { ...base, status: random() < 0.5 ? 'currently-reading' : 'to-read', rating: null, lastRead: null };
    }
    const daysAgo = Math.floor(random() * 3 * 365);
    return {
      ...base,
      status: 'read',
      // Quarter stars from 2.5 to 5, as StoryGraph allows.
      rating: 2.5 + Math.round(random() * 10) / 4,
      lastRead: new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10),
    };
  });
}
