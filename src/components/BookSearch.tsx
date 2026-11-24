import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { track } from '../lib/telemetry';
import { idSmallUrl, lookupIsbn } from '../lib/covers';
import { parseIsbn } from '../lib/csv';
import { isbnOfEdition, MIN_QUERY, searchBooks, type SearchResult } from '../lib/search';

/** A book chosen in the search, ready to add. */
export interface FoundBook {
  title: string;
  authors: string;
  isbn: string | null;
  /** Open Library work key, used as the id when there is no ISBN. */
  key: string | null;
  /** Typed in rather than found: never looked up on Open Library. */
  blank?: boolean;
}

interface Props {
  onAdd: (book: FoundBook) => void;
  onError: (message: string) => void;
}

/** Pause after typing before searching, so each keystroke is not a request. */
const DEBOUNCE_MS = 250;

type Option = { kind: 'isbn'; isbn: string } | { kind: 'result'; result: SearchResult } | { kind: 'blank'; title: string };

/** Search-as-you-type for adding any book by title, author or ISBN, with Open Library suggestions. */
export function BookSearch({ onAdd, onError }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [adding, setAdding] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const isbn = parseIsbn(q);

  useEffect(() => {
    setFailed(false);
    if (isbn || q.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchBooks(q, controller.signal)
        .then((r) => {
          setResults(r);
          setHighlight(0);
          track('search', { found: r.length > 0, results: r.length });
        })
        .catch(() => {
          // An abort just means a newer search took over.
          if (!controller.signal.aborted) {
            setResults([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, isbn]);

  // Clicking elsewhere closes the suggestions.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const found: Option[] = isbn ? [{ kind: 'isbn', isbn }] : results.map((result) => ({ kind: 'result', result }));
  // Last, for a book Open Library does not have (or has wrong): add it as typed, with no lookup.
  const options: Option[] = !isbn && !searching ? [...found, { kind: 'blank', title: q }] : found;
  // Nothing shows until there is enough to search on, or an ISBN.
  const showList = open && (Boolean(isbn) || q.length >= MIN_QUERY);

  async function choose(option: Option) {
    setAdding(true);
    try {
      if (option.kind === 'blank') {
        onAdd({ title: option.title, authors: '', isbn: null, key: null, blank: true });
      } else if (option.kind === 'isbn') {
        const found = await lookupIsbn(option.isbn);
        if (!found) {
          onError(`Open Library has no book with ISBN ${option.isbn}.`);
          return;
        }
        onAdd({ ...found, isbn: option.isbn, key: null });
      } else {
        const r = option.result;
        // The ISBN of the edition whose cover was shown, so the label gets that cover.
        const found = r.coverEdition ? await isbnOfEdition(r.coverEdition).catch(() => null) : null;
        onAdd({ title: r.title, authors: r.authors, isbn: found, key: r.key });
      }
      setQuery('');
      setOpen(false);
    } catch {
      onError('Could not reach Open Library. Try again in a moment.');
    } finally {
      setAdding(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length) {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlight((h) => (h + step + options.length) % options.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[highlight];
      if (option && !adding) void choose(option);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const activeId = showList && options[highlight] ? `${listId}-${highlight}` : undefined;

  return (
    <div className="book-search" ref={box}>
      <label htmlFor={`${listId}-input`}>Add any book: title, author or ISBN</label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        placeholder="e.g. Piranesi, or Susanna Clarke"
        value={query}
        disabled={adding}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="search-results" id={listId} role="listbox">
          {options.map((option, i) => (
            <li
              key={option.kind === 'isbn' ? option.isbn : option.kind === 'blank' ? 'blank' : option.result.key}
              className={option.kind === 'blank' ? 'blank-option' : undefined}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onPointerEnter={() => setHighlight(i)}
              // Pointer down rather than click, so the input keeps focus and the list does not close first.
              onPointerDown={(e) => {
                e.preventDefault();
                if (!adding) void choose(option);
              }}
            >
              {option.kind === 'isbn' ? (
                <span className="result-text">
                  <strong>Add ISBN {option.isbn}</strong>
                  <span className="muted">Looked up on Open Library</span>
                </span>
              ) : option.kind === 'blank' ? (
                <>
                  <span className="no-cover" aria-hidden="true" />
                  <span className="result-text">
                    <strong>Add &ldquo;{option.title}&rdquo; as a blank book</strong>
                    <span className="muted">Not looked up. Add your own cover, or keep a plain one.</span>
                  </span>
                </>
              ) : (
                <>
                  {option.result.coverId ? (
                    <img
                      src={idSmallUrl(option.result.coverId)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="no-cover" aria-hidden="true" />
                  )}
                  <span className="result-text">
                    <strong>{option.result.title}</strong>
                    <span className="muted">
                      {[option.result.authors, option.result.year].filter(Boolean).join(', ')}
                    </span>
                  </span>
                </>
              )}
            </li>
          ))}
          {found.length === 0 && (
            <li className="search-status muted" role="presentation">
              {failed ? 'Could not reach Open Library.' : searching ? 'Searching...' : 'No books found.'}
            </li>
          )}
          {adding && (
            <li className="search-status muted" role="presentation">
              Adding...
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
