import { useMemo, useState } from 'react';
import { BookList } from './components/BookList';
import { FiltersPanel } from './components/FiltersPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Sheet } from './components/Sheet';
import { parseStoryGraphCsv } from './lib/csv';
import { applyFilters, selectBooks } from './lib/filter';
import { gridFor, paginate } from './lib/layout';
import type { Book, Filters, Settings } from './lib/types';
import { useCovers } from './lib/useCovers';

const DEFAULT_FILTERS: Filters = { statuses: ['read'], minRating: 0, from: '', to: '', sort: 'rating', count: 20 };
const DEFAULT_SETTINGS: Settings = {
  height: 30,
  width: 20,
  spine: 5,
  style: 'edge',
  paper: 'letter',
  margin: 10,
  gap: 2,
};

export function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [customCovers, setCustomCovers] = useState<Record<string, string>>({});

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
      setBooks(parsed);
      setOverrides({});
      setCustomCovers({});
      setError(parsed.length ? '' : 'That file has no books in it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="app">
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
          {error && <p className="error">{error}</p>}
        </section>

        {books.length > 0 && (
          <>
            <section>
              <h2>2. Pick books</h2>
              <FiltersPanel books={books} filters={filters} onChange={setFilters} />
              <BookList
                books={books}
                listed={listed}
                overrides={overrides}
                customCovers={customCovers}
                coverOf={coverOf}
                onToggle={(id, on) => setOverrides((o) => ({ ...o, [id]: on }))}
                onCustomCover={(id, url) =>
                  setCustomCovers(({ [id]: _old, ...rest }) => (url ? { ...rest, [id]: url } : rest))
                }
              />
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

      <main className="preview">
        {pages.length > 0 ? (
          <Sheet pages={pages} settings={settings} cols={grid.cols} coverOf={coverOf} />
        ) : (
          <p className="empty muted">Your printable sheet will appear here.</p>
        )}
      </main>
    </div>
  );
}
