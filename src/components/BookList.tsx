import { useState } from 'react';
import type { CoverResult, CoverSource } from '../lib/covers';
import type { Book } from '../lib/types';

interface Props {
  books: Book[];
  listed: Book[];
  overrides: Record<string, boolean>;
  customCovers: Record<string, string>;
  coverOf: (book: Book) => CoverResult | undefined;
  onToggle: (id: string, on: boolean) => void;
  onCustomCover: (id: string, url: string | null) => void;
}

const BADGE: Record<CoverSource, string> = {
  isbn: 'cover found',
  search: 'matched by title',
  custom: 'your cover',
  generated: 'no cover, generated',
};

export function BookList({ books, listed, overrides, customCovers, coverOf, onToggle, onCustomCover }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');

  const listedIds = new Set(listed.map((b) => b.id));
  const q = query.trim().toLowerCase();
  const matches = q
    ? books.filter((b) => !listedIds.has(b.id) && `${b.title} ${b.authors}`.toLowerCase().includes(q)).slice(0, 8)
    : [];

  return (
    <div className="booklist">
      {listed.length === 0 && <p className="muted">No books match these filters.</p>}
      <ul>
        {listed.map((b) => {
          const cover = coverOf(b);
          return (
            <li key={b.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={overrides[b.id] !== false}
                  onChange={(e) => onToggle(b.id, e.target.checked)}
                />
                <span>
                  <strong>{b.title}</strong> <span className="muted">{b.authors}</span>
                  {b.rating !== null && <span className="muted"> ({b.rating} stars)</span>}
                </span>
              </label>
              <div className="meta">
                <span className={`badge ${cover?.source ?? 'loading'}`}>
                  {cover ? BADGE[cover.source] : 'loading cover'}
                </span>
                <button
                  className="link"
                  onClick={() => {
                    setEditing(editing === b.id ? null : b.id);
                    setUrl('');
                  }}
                >
                  {editing === b.id ? 'Close' : 'Replace cover'}
                </button>
              </div>
              {editing === b.id && (
                <div className="cover-edit">
                  <div className="row">
                    <input
                      type="url"
                      placeholder="Paste an image URL"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <button disabled={!url.trim()} onClick={() => onCustomCover(b.id, url.trim())}>
                      Use
                    </button>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onCustomCover(b.id, URL.createObjectURL(file));
                    }}
                  />
                  {customCovers[b.id] && (
                    <button className="link" onClick={() => onCustomCover(b.id, null)}>
                      Back to automatic cover
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <label>
        Add a book the filters missed
        <input
          type="search"
          placeholder="Search your library by title or author"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {q && matches.length === 0 && <p className="muted">Nothing else in your library matches.</p>}
      <ul>
        {matches.map((b) => (
          <li key={b.id} className="match">
            <span>
              <strong>{b.title}</strong> <span className="muted">{b.authors}</span>
            </span>
            <button onClick={() => onToggle(b.id, true)}>Add</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
