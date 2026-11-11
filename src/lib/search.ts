import { parseIsbn } from './csv';

/** One suggestion in the add-a-book search. */
export interface SearchResult {
  /** Open Library work key, e.g. /works/OL27448W. */
  key: string;
  title: string;
  authors: string;
  year?: number;
  /** Open Library cover id, for the thumbnail. */
  coverId?: number;
  /** The edition whose cover Open Library shows for the work; its ISBN is looked up when picked. */
  coverEdition?: string;
}

interface SearchDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  cover_edition_key?: string;
}

export const SEARCH_LIMIT = 8;
/** Characters typed before searching starts. */
export const MIN_QUERY = 3;

export function parseSearchDocs(docs: SearchDoc[]): SearchResult[] {
  return docs
    .filter((d) => d.key && d.title)
    .map((d) => ({
      key: d.key!,
      title: d.title!,
      authors: d.author_name?.slice(0, 3).join(', ') ?? '',
      year: d.first_publish_year,
      coverId: d.cover_i && d.cover_i > 0 ? d.cover_i : undefined,
      coverEdition: d.cover_edition_key,
    }));
}

export function searchQueryUrl(query: string): string {
  const params = new URLSearchParams({
    q: query.trim(),
    fields: 'key,title,author_name,first_publish_year,cover_i,cover_edition_key',
    limit: String(SEARCH_LIMIT),
  });
  // Through our Worker, which caches Open Library at the edge (worker/openLibrary.ts).
  return `/api/ol/search?${params}`;
}

const cache = new Map<string, SearchResult[]>();

/** Books matching a title, author or both. Results are cached for the session, so retyping is free. */
export async function searchBooks(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  const hit = cache.get(q);
  if (hit) return hit;
  const res = await fetch(searchQueryUrl(q), { signal });
  if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
  const body: { docs?: SearchDoc[] } = await res.json();
  const results = parseSearchDocs(body.docs ?? []);
  cache.set(q, results);
  return results;
}

/** The ISBN of an Open Library edition (ISBN-13 preferred), or null if it has none. */
export async function isbnOfEdition(edition: string): Promise<string | null> {
  const res = await fetch(`/api/ol/books/${encodeURIComponent(edition)}`);
  if (!res.ok) return null;
  const body: { isbn_13?: string[]; isbn_10?: string[] } = await res.json();
  for (const isbn of [...(body.isbn_13 ?? []), ...(body.isbn_10 ?? [])]) {
    const valid = parseIsbn(isbn);
    if (valid) return valid;
  }
  return null;
}
