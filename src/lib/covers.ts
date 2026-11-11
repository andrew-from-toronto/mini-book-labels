import { detectImageSpine, spineFromPages } from './spine';
import { detectImageTrim } from './trim';
import type { Book, Crop, CustomCover, WrapSpine } from './types';

export type CoverSource = 'isbn' | 'search' | 'custom' | 'wrap' | 'generated';

export interface CoverResult {
  image: HTMLImageElement | null;
  source: CoverSource;
  /** For wraps: the spine found in the artwork, or null if none was found. */
  detectedSpine?: WrapSpine | null;
  /** How `detectedSpine` was found: in the artwork itself, or estimated from the page count. */
  spineFrom?: 'artwork' | 'pages';
  /** The page count behind a 'pages' estimate. */
  pages?: number;
  /** Set when a pasted link was swapped for a bigger version of the same image. */
  upgraded?: 'original' | 'larger';
  /** For user-supplied images: stray borders found at the edges, or null if there are none. */
  detectedCrop?: Crop | null;
}

/**
 * Larger versions of a Pinterest image, best first. Pinterest keeps every image under the same path
 * at several widths (236x, 474x, 736x, 1200x) plus the upload itself under /originals/, where the
 * file extension is the uploader's and often differs from the resized copies (commonly .png).
 * Links copied from a pin are usually the 736x copy. Empty for links that are not Pinterest images.
 */
export function pinterestVariants(url: string): string[] {
  const match = url.match(/^(https?:\/\/i\.pinimg\.com)\/(?:\d+x\d*|originals)\/(.+)\.(\w+)$/);
  if (!match) return [];
  const [, host, path, ext] = match;
  const originals = [...new Set(['png', ext, 'jpg'])].map((e) => `${host}/originals/${path}.${e}`);
  return [...originals, `${host}/1200x/${path}.${ext}`];
}

/**
 * Re-serves an image from our own address (worker/imageProxy.ts) so its pixels can be read. Hosts like
 * Pinterest send no CORS headers.
 */
export const proxiedUrl = (url: string) => `/api/image?url=${encodeURIComponent(url)}`;

/** Open Library, through our Worker (worker/openLibrary.ts), which caches it at the edge. */
const OL = '/api/ol';
const COVERS = '/api/cover';

// default=false makes Open Library return 404 instead of a blank placeholder image.
export const isbnCoverUrl = (isbn: string) => `${COVERS}/isbn/${isbn}-L.jpg`;
export const idCoverUrl = (id: number) => `${COVERS}/id/${id}-L.jpg`;
export const idSmallUrl = (id: number) => `${COVERS}/id/${id}-S.jpg`;
export const idThumbUrl = (id: number) => `${COVERS}/id/${id}-M.jpg`;

/** The Open Library cover id in a URL made by `idCoverUrl`, or null for any other URL. */
export function coverIdFromUrl(url: string): number | null {
  // Our own path, or Open Library's, as saved before covers went through the Worker.
  const match = url.match(/^(?:\/api\/cover|https:\/\/covers\.openlibrary\.org\/b)\/id\/(\d+)-L\.jpg/);
  return match ? Number(match[1]) : null;
}

/** A cover from one of the book's editions on Open Library. */
export interface CoverVariant {
  id: number;
  /** Publication year, when the edition gives one. */
  year?: string;
  english: boolean;
}

/** An entry from Open Library's /works/{id}/editions.json. */
export interface EditionEntry {
  covers?: number[];
  languages?: { key: string }[];
  publish_date?: string;
}

/** Most variants offered for one book. */
export const MAX_VARIANTS = 30;

/**
 * Turns a work's editions into a list of distinct covers: English (or unlabelled) editions first,
 * then the rest, newest cover uploads first within each group since they are more often clean
 * publisher images than scans. `first`, the cover currently in use, leads the list if present.
 */
export function pickVariants(entries: EditionEntry[], first?: number | null): CoverVariant[] {
  const seen = new Set<number>();
  const variants: CoverVariant[] = [];
  for (const e of entries) {
    const english = !e.languages?.length || e.languages.some((l) => l.key === '/languages/eng');
    const year = e.publish_date?.match(/\d{4}/)?.[0];
    for (const id of e.covers ?? []) {
      // Open Library uses -1 for a removed cover.
      if (id <= 0 || seen.has(id)) continue;
      seen.add(id);
      variants.push({ id, year, english });
    }
  }
  variants.sort((a, b) => Number(b.id === first) - Number(a.id === first) || Number(b.english) - Number(a.english) || b.id - a.id);
  return variants.slice(0, MAX_VARIANTS);
}

const variantCache = new Map<string, Promise<CoverVariant[]>>();

/** Covers from every edition of the book on Open Library, found by ISBN or else by title and author. */
export function lookupCoverVariants(book: Pick<Book, 'title' | 'authors' | 'isbn'>): Promise<CoverVariant[]> {
  const params = new URLSearchParams({ fields: 'key,cover_i', limit: '1' });
  if (book.isbn) params.set('isbn', book.isbn);
  else {
    params.set('title', cleanTitle(book.title));
    if (firstAuthor(book.authors)) params.set('author', firstAuthor(book.authors));
  }
  const key = params.toString();
  let pending = variantCache.get(key);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${OL}/search?${params}`);
      if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
      const body: { docs?: { key?: string; cover_i?: number }[] } = await res.json();
      const doc = body.docs?.[0];
      if (!doc?.key?.startsWith('/works/')) return [];
      const eds = await fetch(`${OL}${doc.key}/editions`);
      if (!eds.ok) throw new Error(`Open Library returned ${eds.status}`);
      const { entries }: { entries?: EditionEntry[] } = await eds.json();
      return pickVariants(entries ?? [], doc.cover_i);
    })();
    // A failed lookup is retried next time rather than cached.
    pending.catch(() => variantCache.delete(key));
    variantCache.set(key, pending);
  }
  return pending;
}

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
  return `${OL}/search?${params}`;
}

export async function lookupIsbn(isbn: string): Promise<Pick<Book, 'title' | 'authors'> | null> {
  const res = await fetch(`${OL}/search?isbn=${isbn}&fields=title,author_name&limit=1`);
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
  const body: { docs?: { title?: string; author_name?: string[] }[] } = await res.json();
  const doc = body.docs?.[0];
  return doc?.title ? { title: doc.title, authors: doc.author_name?.join(', ') ?? '' } : null;
}

/** Median page count across the book's editions, or null if Open Library has none. */
export async function lookupPages(book: Pick<Book, 'title' | 'authors' | 'isbn'>): Promise<number | null> {
  const params = new URLSearchParams({ fields: 'number_of_pages_median', limit: '1' });
  if (book.isbn) params.set('isbn', book.isbn);
  else {
    params.set('title', cleanTitle(book.title));
    if (firstAuthor(book.authors)) params.set('author', firstAuthor(book.authors));
  }
  const res = await fetch(`${OL}/search?${params}`);
  if (!res.ok) return null;
  const body: { docs?: { number_of_pages_median?: number }[] } = await res.json();
  return body.docs?.[0]?.number_of_pages_median ?? null;
}

/** Uploaded files become downscaled data URLs so they can be saved with the rest of the session. */
export async function fileToDataUrl(file: File, maxSide = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Search pages where people share complete back + spine + front artwork. Opened in a tab, never fetched. */
export function wrapSearchUrls(book: Pick<Book, 'title' | 'authors'>) {
  const q = encodeURIComponent(`${cleanTitle(book.title)} ${firstAuthor(book.authors)} full book cover spine back`);
  return {
    pinterest: `https://www.pinterest.com/search/pins/?q=${q}`,
    google: `https://www.google.com/search?tbm=isch&q=${q}`,
  };
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

async function resolve(book: Book, custom: CustomCover | undefined): Promise<CoverResult> {
  if (custom) {
    try {
      // Last resort is an unreadable image: it still displays, but colours and the spine cannot be sampled.
      const load = (url: string) =>
        loadImage(url)
          .catch(() => (/^https?:/.test(url) ? loadImage(proxiedUrl(url)) : Promise.reject()))
          .catch(() => loadImage(url, false));
      let image: HTMLImageElement | null = null;
      let upgraded: CoverResult['upgraded'];
      // Pinterest sends no CORS headers, so its variants are probed through the proxy only.
      for (const variant of pinterestVariants(custom.url)) {
        image = await loadImage(proxiedUrl(variant)).catch(() => null);
        if (!image) continue;
        if (variant !== custom.url) upgraded = variant.includes('/originals/') ? 'original' : 'larger';
        break;
      }
      image ??= await load(custom.url);
      const found = { image, upgraded, detectedCrop: detectImageTrim(image) };
      if (!custom.wrap) return { ...found, source: 'custom' };
      const inArtwork = detectImageSpine(image);
      if (inArtwork) return { ...found, source: 'wrap', detectedSpine: inArtwork, spineFrom: 'artwork' };
      const pages = await lookupPages(book).catch(() => null);
      return pages
        ? { ...found, source: 'wrap', detectedSpine: spineFromPages(pages), spineFrom: 'pages', pages }
        : { ...found, source: 'wrap', detectedSpine: null };
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

export function resolveCover(book: Book, custom?: CustomCover): Promise<CoverResult> {
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
