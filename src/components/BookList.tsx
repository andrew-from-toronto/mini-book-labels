import { useState } from 'react';
import { fileToDataUrl, wrapSearchUrls, type CoverResult, type CoverSource } from '../lib/covers';
import type { Book, CustomCover, WrapSpine } from '../lib/types';

interface Props {
  books: Book[];
  listed: Book[];
  overrides: Record<string, boolean>;
  customCovers: Record<string, CustomCover>;
  /** Spine position used for wrap artwork when none is detected or set by hand. */
  defaultWrapSpine: WrapSpine;
  /** Book whose cover panel is open. */
  editing: string | null;
  onEditing: (id: string | null) => void;
  coverOf: (book: Book) => CoverResult | undefined;
  onToggle: (id: string, on: boolean) => void;
  onCustomCover: (id: string, cover: CustomCover | null) => void;
}

const BADGE: Record<CoverSource, string> = {
  isbn: 'cover found',
  search: 'matched by title',
  custom: 'your cover',
  wrap: 'your full wrap',
  generated: 'no cover, generated',
};

interface SpineControlsProps {
  spine: WrapSpine;
  detected: boolean;
  manual: boolean;
  onChange: (spine: WrapSpine | undefined) => void;
}

function SpineControls({ spine, detected, manual, onChange }: SpineControlsProps) {
  const centre = (spine.left + spine.right) / 2;
  const width = spine.right - spine.left;
  const set = (c: number, w: number) => onChange({ left: c - w / 2, right: c + w / 2 });

  return (
    <>
      <span className="muted find">
        {manual
          ? 'Spine set by hand.'
          : detected
            ? 'Spine found automatically. Adjust below if it is off.'
            : 'Could not find the spine in this artwork, so it is assumed to be centred. Adjust below.'}{' '}
        {manual && (
          <button className="link" onClick={() => onChange(undefined)}>
            Back to automatic
          </button>
        )}
      </span>
      <label>
        Spine width: {(width * 100).toFixed(1)}% of the image
        <input
          type="range"
          min={0.01}
          max={0.3}
          step={0.0025}
          value={width}
          onChange={(e) => set(centre, Number(e.target.value))}
        />
      </label>
      <label>
        Spine position: {(centre * 100).toFixed(1)}% across
        <input
          type="range"
          min={0.3}
          max={0.7}
          step={0.0025}
          value={centre}
          onChange={(e) => set(Number(e.target.value), width)}
        />
      </label>
    </>
  );
}

export function BookList({
  books,
  listed,
  overrides,
  customCovers,
  defaultWrapSpine,
  editing,
  onEditing: setEditing,
  coverOf,
  onToggle,
  onCustomCover,
}: Props) {
  const [url, setUrl] = useState('');
  const [wrap, setWrap] = useState(false);
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
                    setUrl(customCovers[b.id]?.url.startsWith('data:') ? '' : (customCovers[b.id]?.url ?? ''));
                    setWrap(customCovers[b.id]?.wrap ?? false);
                  }}
                >
                  {editing === b.id ? 'Close' : 'Replace cover'}
                </button>
              </div>
              {editing === b.id && (
                <div className="cover-edit">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={wrap}
                      onChange={(e) => {
                        setWrap(e.target.checked);
                        const current = customCovers[b.id];
                        if (current) onCustomCover(b.id, { ...current, wrap: e.target.checked });
                      }}
                    />
                    Image is the full wrap (back, spine and front)
                  </label>
                  <span className="muted find">
                    Find full wrap artwork on{' '}
                    <a href={wrapSearchUrls(b).pinterest} target="_blank" rel="noreferrer">
                      Pinterest
                    </a>{' '}
                    or{' '}
                    <a href={wrapSearchUrls(b).google} target="_blank" rel="noreferrer">
                      Google Images
                    </a>
                    , then copy the image address and paste it below.
                  </span>
                  <div className="row">
                    <input
                      type="url"
                      placeholder="Paste an image URL"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    <button disabled={!url.trim()} onClick={() => onCustomCover(b.id, { url: url.trim(), wrap })}>
                      Use
                    </button>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void fileToDataUrl(file).then((url) => onCustomCover(b.id, { url, wrap }));
                    }}
                  />
                  {customCovers[b.id]?.wrap && cover?.source === 'wrap' && (
                    <SpineControls
                      spine={customCovers[b.id].spine ?? cover.detectedSpine ?? defaultWrapSpine}
                      detected={Boolean(cover.detectedSpine)}
                      manual={Boolean(customCovers[b.id].spine)}
                      onChange={(spine) => onCustomCover(b.id, { ...customCovers[b.id], spine })}
                    />
                  )}
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
