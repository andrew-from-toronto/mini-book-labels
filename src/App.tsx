import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { BookList } from './components/BookList';
import { FiltersPanel } from './components/FiltersPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Preview } from './components/Preview';
import { lookupIsbn } from './lib/covers';
import { parseIsbn, parseStoryGraphCsv } from './lib/csv';
import { applyFilters, selectBooks } from './lib/filter';
import { defaultWrapSpine, gridFor, paginate } from './lib/layout';
import { loadState, saveState, type Panes } from './lib/storage';
import type { Book, CustomCover, Filters, Settings } from './lib/types';
import { useCovers } from './lib/useCovers';

const DEFAULT_FILTERS: Filters = { statuses: ['read'], minRating: 0, from: '', to: '', sort: 'rating', count: 20 };
/** Status given to books added by ISBN, which survive loading a new CSV. */
const ADDED = 'added';

const DEFAULT_SETTINGS: Settings = {
  height: 30,
  width: 20,
  spine: 5,
  style: 'edge',
  paper: 'letter',
  margin: 10,
  gap: 2,
  guideOpacity: 1,
};

const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));

interface HandleProps {
  label: string;
  /** Called with the pointer's x position while dragging. */
  onResize: (clientX: number) => void;
  onReset: () => void;
}

function Handle({ label, onResize, onReset }: HandleProps) {
  return (
    <div
      className="handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onResize(e.clientX);
      }}
      onDoubleClick={onReset}
    />
  );
}

export function App() {
  const [saved] = useState(loadState);
  const [books, setBooks] = useState<Book[]>(saved.books ?? []);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, ...saved.filters });
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS, ...saved.settings });
  const [overrides, setOverrides] = useState<Record<string, boolean>>(saved.overrides ?? {});
  const [customCovers, setCustomCovers] = useState<Record<string, CustomCover>>(saved.customCovers ?? {});

  const [panes, setPanes] = useState<Panes>(saved.panes ?? {});

  useEffect(() => {
    // Debounced: sliders change state many times a second and the library can be large.
    const timer = setTimeout(() => saveState({ books, filters, settings, overrides, customCovers, panes }), 300);
    return () => clearTimeout(timer);
  }, [books, filters, settings, overrides, customCovers, panes]);
  const [isbnInput, setIsbnInput] = useState('');
  const [adding, setAdding] = useState(false);
  /** The book being worked on: its cover controls are open and the preview zooms to its label. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const { listed, selected } = useMemo(
    () => selectBooks(books, applyFilters(books, filters), overrides),
    [books, filters, overrides],
  );
  const coverOf = useCovers(listed, customCovers);
  const grid = gridFor(settings);
  const pages = paginate(selected, grid.perPage);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseStoryGraphCsv(await file.text());
      const added = books.filter((b) => b.status === ADDED);
      const keep = new Set(added.map((b) => b.id));
      setBooks([...parsed, ...added]);
      setActiveId(null);
      setOverrides(Object.fromEntries(added.map((b) => [b.id, true])));
      setCustomCovers((c) => Object.fromEntries(Object.entries(c).filter(([id]) => keep.has(id))));
      setError(parsed.length ? '' : 'That file has no books in it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function startOver() {
    if (!window.confirm('Remove all books, covers and settings from this browser?')) return;
    setBooks([]);
    setFilters(DEFAULT_FILTERS);
    setSettings(DEFAULT_SETTINGS);
    setOverrides({});
    setCustomCovers({});
    setActiveId(null);
    setError('');
  }

  async function addByIsbn() {
    const isbn = parseIsbn(isbnInput);
    if (!isbn) {
      setError('That is not a 10 or 13 digit ISBN.');
      return;
    }
    const id = `isbn-${isbn}`;
    setAdding(true);
    try {
      const found = books.find((b) => b.id === id) ?? (await lookupIsbn(isbn));
      if (!found) {
        setError(`Open Library has no book with ISBN ${isbn}.`);
        return;
      }
      const book: Book = { id, title: found.title, authors: found.authors, isbn, status: ADDED, rating: null, lastRead: null };
      setBooks((bs) => (bs.some((b) => b.id === id) ? bs : [...bs, book]));
      setOverrides((o) => ({ ...o, [id]: true }));
      setIsbnInput('');
      setError('');
    } catch {
      setError('Could not reach Open Library. Try again in a moment.');
    } finally {
      setAdding(false);
    }
  }

  const layoutKey = JSON.stringify([
    selected.map((b) => b.id),
    settings.height,
    settings.width,
    settings.spine,
    settings.paper,
    settings.margin,
    settings.gap,
  ]);

  return (
    <div
      className={expanded ? 'app expanded' : 'app'}
      style={
        {
          '--setup-width': panes.setup && `${panes.setup}px`,
          '--preview-width': panes.preview && `${panes.preview}px`,
        } as CSSProperties
      }
    >
      <aside className="controls">
        <h1>Mini Book Labels</h1>
        <p className="muted">
          Wraparound labels for 3D printed mini books, from your StoryGraph library. Your file stays in your browser.
        </p>

        <section>
          <h2>1. Library</h2>
          <p className="muted">On StoryGraph: Manage Account, then Export StoryGraph Library. Drop the CSV here.</p>
          <label
            className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void loadFile(e.dataTransfer.files[0]);
            }}
          >
            <input type="file" accept=".csv,text/csv" onChange={(e) => void loadFile(e.target.files?.[0])} />
            {books.length ? `${books.length} books loaded. Choose another file to replace.` : 'Choose or drop a CSV'}
          </label>
          <form
            className="row add-isbn"
            onSubmit={(e) => {
              e.preventDefault();
              void addByIsbn();
            }}
          >
            <label>
              Or add any book by ISBN
              <input
                type="search"
                inputMode="numeric"
                placeholder="e.g. 9780140328721"
                value={isbnInput}
                onChange={(e) => setIsbnInput(e.target.value)}
              />
            </label>
            <button disabled={adding || !isbnInput.trim()}>{adding ? 'Looking up' : 'Add'}</button>
          </form>
          {error && <p className="error">{error}</p>}
          {books.length > 0 && (
            <p className="muted">
              Your work is saved in this browser.{' '}
              <button className="link" onClick={startOver}>
                Start over
              </button>
            </p>
          )}
        </section>

        {books.length > 0 && (
          <>
            <section>
              <h2>2. Filters</h2>
              <FiltersPanel books={books} filters={filters} onChange={setFilters} />
            </section>

            <section>
              <h2>3. Label and sheet</h2>
              <SettingsPanel settings={settings} onChange={setSettings} />
            </section>

            <section>
              <h2>4. Print</h2>
              {grid.perPage === 0 ? (
                <p className="error">A label does not fit on the page with these sizes and margins.</p>
              ) : (
                <p className="muted">
                  {selected.length} labels on {pages.length} {pages.length === 1 ? 'page' : 'pages'} ({grid.cols} x{' '}
                  {grid.rows} per page). Print at 100% scale ("Actual size"), then check the 50 mm ruler.
                </p>
              )}
              <button className="primary" disabled={pages.length === 0} onClick={() => window.print()}>
                Print sheet
              </button>
            </section>
          </>
        )}

        <footer className="muted">
          Covers from <a href="https://openlibrary.org">Open Library</a>.{' '}
          <a href="https://github.com/andrew-from-toronto/mini-book-labels">Source</a>.{' '}
          <a href="https://buymeacoffee.com/andrew.from.toronto">Buy me a coffee</a>.
        </footer>
      </aside>

      <Handle
        label="Resize setup column"
        onResize={(x) => setPanes((p) => ({ ...p, setup: clamp(x, 240, window.innerWidth * 0.4) }))}
        onReset={() => setPanes(({ setup: _setup, ...rest }) => rest)}
      />

      <main className="books">
        {books.length > 0 ? (
          <BookList
            books={books}
            listed={listed}
            overrides={overrides}
            customCovers={customCovers}
            settings={settings}
            defaultWrapSpine={defaultWrapSpine(settings)}
            activeId={activeId}
            onActive={setActiveId}
            coverOf={coverOf}
            onToggle={(id, on) => setOverrides((o) => ({ ...o, [id]: on }))}
            onCustomCover={(id, cover) =>
              setCustomCovers(({ [id]: _old, ...rest }) => (cover ? { ...rest, [id]: cover } : rest))
            }
          />
        ) : (
          <p className="empty muted">Load your StoryGraph export or add a book by ISBN to start.</p>
        )}
      </main>

      <Handle
        label="Resize print preview"
        onResize={(x) =>
          setPanes((p) => ({ ...p, preview: clamp(window.innerWidth - x, 280, window.innerWidth * 0.7) }))
        }
        onReset={() => setPanes(({ preview: _preview, ...rest }) => rest)}
      />

      <Preview
        pages={pages}
        settings={settings}
        cols={grid.cols}
        coverOf={coverOf}
        customCovers={customCovers}
        activeId={activeId}
        expanded={expanded}
        onExpanded={setExpanded}
        layoutKey={layoutKey}
      />
    </div>
  );
}
