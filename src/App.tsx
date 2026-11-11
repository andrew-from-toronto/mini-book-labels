import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AfterPrintDialog } from './components/AfterPrintDialog';
import { BookList } from './components/BookList';
import { BookSearch, type FoundBook } from './components/BookSearch';
import { FiltersPanel } from './components/FiltersPanel';
import { ModelPanel } from './components/ModelPanel';
import { Preview, type PreviewView } from './components/Preview';
import { SettingsPanel } from './components/SettingsPanel';
import { DEFAULT_SETTINGS } from './lib/defaults';
import { backupFileName, makeBackup, parseBackup } from './lib/backup';
import { decodeOrder } from './lib/orderCode';
import { parseLibraryCsv } from './lib/csv';
import { saveFile } from './lib/download';
import { applyFilters, selectBooks } from './lib/filter';
import { defaultWrapSpine, gridFor, paginate } from './lib/layout';
import { isSample, sampleLibrary } from './lib/sample';
import { loadState, saveState, type Panes } from './lib/storage';
import type { Book, CustomCover, Filters, Settings } from './lib/types';
import { useCovers } from './lib/useCovers';

// three.js is large, so the 3D view loads only when it is first opened.
const Book3D = lazy(() => import('./components/Book3D'));
// Stripe loads only when someone opens the coffee dialog, not on every visit.
const CoffeeDialog = lazy(() => import('./components/CoffeeDialog').then((m) => ({ default: m.CoffeeDialog })));

const DEFAULT_FILTERS: Filters = { statuses: ['read'], minRating: 0, from: '', to: '', sort: 'rating', count: 20 };
/** Status given to books added by search, which survive loading a new library. */
const ADDED = 'added';

/** On narrow screens one pane shows at a time, picked from a bar along the bottom. */
type Tab = 'setup' | 'books' | 'preview';

/**
 * Saved settings over the defaults. Model options are merged too, so sessions and backups made before
 * a new option was added still get it.
 */
const withDefaults = (saved: Partial<Settings> | undefined): Settings => ({
  ...DEFAULT_SETTINGS,
  ...saved,
  model: { ...DEFAULT_SETTINGS.model, ...saved?.model },
});

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
  // Back from a bank's own check on a coffee: open straight to the thank-you, and tidy the address.
  const [coffeeThanks] = useState(() => new URLSearchParams(location.search).get('coffee') === 'thanks');
  const [coffee, setCoffee] = useState(coffeeThanks);
  useEffect(() => {
    if (!coffeeThanks) return;
    const params = new URLSearchParams(location.search);
    params.delete('coffee');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  }, [coffeeThanks]);
  const [afterPrint, setAfterPrint] = useState(false);

  // After the sheet is printed (the button or Ctrl+P), offer the books once a visit.
  useEffect(() => {
    const shown = () => {
      try {
        return sessionStorage.getItem('after-print-shown') === '1';
      } catch {
        return false;
      }
    };
    const onAfterPrint = () => {
      if (shown()) return;
      try {
        sessionStorage.setItem('after-print-shown', '1');
      } catch {
        // Private browsing: it may show again next print.
      }
      setAfterPrint(true);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, []);
  const [books, setBooks] = useState<Book[]>(saved.books ?? []);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, ...saved.filters });
  const [settings, setSettings] = useState<Settings>(() => withDefaults(saved.settings));
  const [overrides, setOverrides] = useState<Record<string, boolean>>(saved.overrides ?? {});
  const [customCovers, setCustomCovers] = useState<Record<string, CustomCover>>(saved.customCovers ?? {});

  const [panes, setPanes] = useState<Panes>(saved.panes ?? {});

  useEffect(() => {
    // Debounced: sliders change state many times a second and the library can be large.
    const timer = setTimeout(() => saveState({ books, filters, settings, overrides, customCovers, panes }), 300);
    return () => clearTimeout(timer);
  }, [books, filters, settings, overrides, customCovers, panes]);
  /** The book being worked on: its cover controls are open and the preview zooms to its label. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('setup');
  const [view, setView] = useState<PreviewView>('sheet');
  /** A paid order opened from its code (#order=...): its book loads into the settings, ready to print. */
  const [openedOrder, setOpenedOrder] = useState<string | null>(null);

  useEffect(() => {
    const openFromAddress = () => {
      const code = new URLSearchParams(location.hash.slice(1)).get('order');
      const order = code ? decodeOrder(code) : null;
      if (!code || !order) return;
      setSettings((s) => ({ ...s, ...order.dims, model: order.options }));
      setOpenedOrder(code.trim());
      setView('3d');
      setTab('setup');
    };
    openFromAddress();
    // Pasting another order onto the address in an open tab changes only the #, which does not reload.
    window.addEventListener('hashchange', openFromAddress);
    return () => window.removeEventListener('hashchange', openFromAddress);
  }, []);

  const { listed, selected } = useMemo(
    () => selectBooks(books, applyFilters(books, filters), overrides),
    [books, filters, overrides],
  );
  const coverOf = useCovers(listed, customCovers);
  const grid = gridFor(settings);
  const pages = paginate(selected, grid.perPage);
  /** The 3D view shows the book being edited, or else the first on the sheet. */
  const book3d = selected.find((b) => b.id === activeId) ?? listed.find((b) => b.id === activeId) ?? selected[0];

  /** Replaces the library (a real export or a sample), keeping only books added by search. */
  function replaceLibrary(next: Book[]) {
    const added = books.filter((b) => b.status === ADDED);
    const keep = new Set(added.map((b) => b.id));
    setBooks([...next, ...added]);
    setActiveId(null);
    setOverrides(Object.fromEntries(added.map((b) => [b.id, true])));
    setCustomCovers((c) => Object.fromEntries(Object.entries(c).filter(([id]) => keep.has(id))));
    setError(next.length ? '' : 'That file has no books in it.');
    // On a phone, go straight to the books that were just loaded.
    if (next.length) setTab('books');
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      replaceLibrary(parseLibraryCsv(await file.text()).books);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Loads a sample that fills one page at the current label size (28 at 1:7 on Letter), with the
   * filters reset so every read book makes the sheet.
   */
  function loadSample() {
    const perPage = grid.perPage || gridFor(DEFAULT_SETTINGS).perPage;
    replaceLibrary(sampleLibrary(perPage));
    setFilters({ ...DEFAULT_FILTERS, count: Math.max(DEFAULT_FILTERS.count, perPage) });
  }

  const libraryBooks = books.filter((b) => b.status !== ADDED);
  const sampleLoaded = isSample(libraryBooks);

  function backUp() {
    saveFile(makeBackup({ books, filters, settings, overrides, customCovers, panes }), backupFileName(), 'application/json');
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const count = backup.books?.length ?? 0;
      if (
        books.length > 0 &&
        !window.confirm(`Replace your current books, covers and settings with this backup of ${count} books?`)
      ) {
        return;
      }
      setBooks(backup.books ?? []);
      setFilters({ ...DEFAULT_FILTERS, ...backup.filters });
      setSettings(withDefaults(backup.settings));
      setOverrides(backup.overrides ?? {});
      setCustomCovers(backup.customCovers ?? {});
      setPanes(backup.panes ?? {});
      setActiveId(null);
      setError('');
      if (count) setTab('books');
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

  /** Adds a book found in the search. Added books survive loading a new library. */
  function addBook(found: FoundBook) {
    const id = found.isbn ? `isbn-${found.isbn}` : `ol-${found.key}`;
    const book: Book = {
      id,
      title: found.title,
      authors: found.authors,
      isbn: found.isbn,
      status: ADDED,
      rating: null,
      lastRead: null,
    };
    setBooks((bs) => (bs.some((b) => b.id === id) ? bs : [...bs, book]));
    setOverrides((o) => ({ ...o, [id]: true }));
    setError('');
    // Open the new book's card, so its cover can be checked or swapped straight away.
    setActiveId(id);
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
      // split: on narrow screens, an open book's card shares the screen with the preview of its label.
      className={['app', expanded && 'expanded', activeId && 'split'].filter(Boolean).join(' ')}
      data-tab={tab}
      style={
        {
          '--setup-width': panes.setup && `${panes.setup}px`,
          '--preview-width': panes.preview && `${panes.preview}px`,
        } as CSSProperties
      }
    >
      <aside className="controls">
        <h1 className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={30} height={30} />
          Mini Book Labels
        </h1>
        <p className="muted">
          Wraparound covers for mini book ornaments and 3D printed miniature books, from your StoryGraph or Goodreads
          library. Your file stays in your browser.
        </p>

        <section>
          <h2>1. Library</h2>
          <p className="muted">
            On StoryGraph: Manage Account, then Export StoryGraph Library. On Goodreads: My Books, then Import and
            export, then Export Library. Drop the CSV here.
          </p>
          <label
            className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void loadFile(e.dataTransfer.files[0]);
            }}
          >
            <input type="file" accept=".csv,text/csv" onChange={(e) => void loadFile(e.target.files?.[0])} />
            {sampleLoaded
              ? `${libraryBooks.length} sample books loaded. Choose your own CSV to replace them.`
              : books.length
                ? `${books.length} books loaded. Choose another file to replace.`
                : 'Choose or drop a CSV'}
          </label>
          <p className="muted sample-line">
            {sampleLoaded ? 'These are sample books. ' : 'No export to hand? '}
            <button className="link" onClick={() => loadSample()}>
              {sampleLoaded ? 'Try a different sample' : 'Try a sample of popular books'}
            </button>
          </p>
          <BookSearch onAdd={addBook} onError={setError} />
          {error && <p className="error">{error}</p>}
          <p className="muted library-actions">
            {books.length > 0 && (
              <>
                Your work is saved in this browser.{' '}
                <button className="link" onClick={backUp} title="Save your books, covers and settings to a file">
                  Back up
                </button>
                {' · '}
              </>
            )}
            <label className="link-button" title="Load books, covers and settings from a backup file">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  void restore(e.target.files?.[0]);
                  // Cleared so choosing the same file again still restores it.
                  e.target.value = '';
                }}
              />
              {books.length > 0 ? 'Restore' : 'Restore a backup'}
            </label>
            {books.length > 0 && (
              <>
                {' · '}
                <button className="link" onClick={startOver}>
                  Start over
                </button>
              </>
            )}
          </p>
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

        {/* Also shown for an opened order, which may arrive in a browser with no books loaded. */}
        {(books.length > 0 || openedOrder) && (
          <section>
            <h2>5. 3D model</h2>
            {openedOrder && (
              <p className="order-loaded">
                Order <code>{openedOrder}</code> is loaded below. Download the 3MF to print it.
              </p>
            )}
            <ModelPanel
              dims={{ height: settings.height, width: settings.width, spine: settings.spine }}
              options={settings.model}
              settings={settings}
              sheetCount={selected.length}
              onChange={(model) => setSettings((s) => ({ ...s, model }))}
              onShow3d={(openTab) => {
                setView('3d');
                if (openTab) setTab('preview');
              }}
            />
          </section>
        )}

        <footer className="site-footer">
          <ul>
            <li>
              <a href={`${import.meta.env.BASE_URL}mini-book-ornaments/`}>Guide</a>
            </li>
            <li>
              <a href={`${import.meta.env.BASE_URL}year-in-books-ornament/`}>Year in books</a>
            </li>
            <li>
              <a href={`${import.meta.env.BASE_URL}blank-books/`}>Blank books</a>
            </li>
            <li>
              <a href={`${import.meta.env.BASE_URL}about/`}>About</a>
            </li>
            <li>
              <a href="https://github.com/andrew-from-toronto/mini-book-labels">Source</a>
            </li>
            <li>
              <button type="button" className="link" onClick={() => setCoffee(true)}>
                Buy me a coffee
              </button>
            </li>
          </ul>
          <p className="muted">
            Covers from <a href="https://openlibrary.org">Open Library</a>
          </p>
          {afterPrint && <AfterPrintDialog settings={settings} sheetCount={selected.length} onCoffee={() => setCoffee(true)} onClose={() => setAfterPrint(false)} />}
          {coffee && (
            <Suspense fallback={null}>
              <CoffeeDialog thanks={coffeeThanks} onClose={() => setCoffee(false)} />
            </Suspense>
          )}
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
          <div className="empty muted">
            <p>Load your StoryGraph or Goodreads export or search for any book under Library to start.</p>
            <button onClick={() => loadSample()}>Or try a sample of popular books</button>
          </div>
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
        view={view}
        onView={setView}
        book3d={
          view === '3d' && (
            <Suspense fallback={<p className="empty muted">Loading the 3D view...</p>}>
              <Book3D
                book={book3d}
                cover={book3d && coverOf(book3d)}
                custom={book3d && customCovers[book3d.id]}
                settings={settings}
              />
            </Suspense>
          )
        }
      />

      <nav className="tabs" aria-label="Sections">
        {(
          [
            ['setup', 'Setup', null],
            ['books', 'Books', books.length ? listed.filter((b) => overrides[b.id] !== false).length : null],
            ['preview', 'Preview', null],
          ] as const
        ).map(([key, text, count]) => (
          <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>
            {text}
            {count !== null && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
