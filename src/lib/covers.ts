import type { Book } from './types';

export type CoverSource = 'isbn' | 'search' | 'custom' | 'generated';

export interface CoverResult {
  image: HTMLImageElement | null;
  source: CoverSource;
}

const COVERS = 'https://covers.openlibrary.org/b';

// default=false makes Open Library return 404 instead of a blank placeholder image.
export const isbnCoverUrl = (isbn: string) => `${COVERS}/isbn/${isbn}-L.jpg?default=false`;
export const idCoverUrl = (id: number) => `${COVERS}/id/${id}-L.jpg?default=false`;

/** Drops series suffixes like "(Discworld #3)" and subtitles, which hurt search matching. */
export const cleanTitle = (title: string) =>
  title
    .replace(/\s*\([^)]*\)/g, '')
    .split(':')[0]
    .trim();

export const firstAuthor = (authors: string) => authors.split(',')[0].trim();

export function searchUrl(book: Pick<Book, 'title' | 'authors'>): string {
  const params = new URLSearchParams({ title: cleanTitle(book.title), fields: 'cover_i', limit: '5' });
  const author = firstAuthor(book.authors);
  if (author) params.set('author', author);
  return `https://openlibrary.org/search.json?${params}`;
}

function loadImage(url: string, cors = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => (img.naturalWidth >= 10 ? resolve(img) : reject(new Error('blank image')));
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

async function searchCoverId(book: Book): Promise<number | null> {
  const res = await fetch(searchUrl(book));
  if (!res.ok) return null;
  const body: { docs?: { cover_i?: number }[] } = await res.json();
  return body.docs?.find((d) => d.cover_i)?.cover_i ?? null;
}

async function resolve(book: Book, custom: string | undefined): Promise<CoverResult> {
  if (custom) {
    try {
      // Hosts without CORS headers still display fine; only colour sampling is lost.
      const image = await loadImage(custom).catch(() => loadImage(custom, false));
      return { image, source: 'custom' };
    } catch {
      /* fall through to the automatic lookup */
    }
  }
  if (book.isbn) {
    try {
      return { image: await loadImage(isbnCoverUrl(book.isbn)), source: 'isbn' };
    } catch {
      /* try search */
    }
  }
  try {
    const id = await searchCoverId(book);
    if (id) return { image: await loadImage(idCoverUrl(id)), source: 'search' };
  } catch {
    /* generated */
  }
  return { image: null, source: 'generated' };
}

// Open Library limits ISBN cover lookups to 100 per 5 minutes per IP, so keep requests gentle.
const MAX_PARALLEL = 4;
let active = 0;
const waiting: (() => void)[] = [];

export function resolveCover(book: Book, custom?: string): Promise<CoverResult> {
  return new Promise((done) => {
    const run = () => {
      active++;
      void resolve(book, custom).then((result) => {
        active--;
        waiting.shift()?.();
        done(result);
      });
    };
    if (active < MAX_PARALLEL) run();
    else waiting.push(run);
  });
}
