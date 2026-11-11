import { useEffect, useRef, useState } from 'react';
import {
  coverIdFromUrl,
  fileToDataUrl,
  idCoverUrl,
  idThumbUrl,
  lookupCoverVariants,
  wrapSearchUrls,
  type CoverResult,
  type CoverSource,
  type CoverVariant,
} from '../lib/covers';
import type { Book, Crop, CustomCover, Settings, WrapSpine } from '../lib/types';
import { Label } from './Label';

interface Props {
  books: Book[];
  listed: Book[];
  overrides: Record<string, boolean>;
  customCovers: Record<string, CustomCover>;
  settings: Settings;
  /** Spine position used for wrap artwork when none is detected or set by hand. */
  defaultWrapSpine: WrapSpine;
  /** The book being worked on: its cover controls are open and the preview zooms to it. */
  activeId: string | null;
  onActive: (id: string | null) => void;
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
  /** Where the automatic spine came from, if one was found. */
  from: CoverResult['spineFrom'];
  pages: number | undefined;
  manual: boolean;
  onChange: (spine: WrapSpine | undefined) => void;
  onNudge: (direction: NudgeDirection, big: boolean) => void;
}

function SpineControls({ spine, from, pages, manual, onChange, onNudge }: SpineControlsProps) {
  const centre = (spine.left + spine.right) / 2;
  const width = spine.right - spine.left;
  const set = (c: number, w: number) => onChange({ left: c - w / 2, right: c + w / 2 });

  return (
    <>
      <span className="muted find">
        {manual
          ? 'Spine set by hand.'
          : from === 'artwork'
            ? 'Spine found in the artwork. Adjust below if it is off.'
            : from === 'pages'
              ? `No spine edges visible in this artwork, so its width is estimated from the page count (${pages} pages). Adjust below if it is off.`
              : 'Could not find the spine or a page count, so it is assumed to match your label. Adjust below.'}{' '}
        <span className="keys-hint">
          Arrow keys nudge it finely: left and right move it, up and down change its width, Shift for bigger steps.
        </span>{' '}
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
      <div className="nudge" role="group" aria-label="Nudge the spine">
        <span className="muted find">Nudge (hold Shift or double-tap for bigger steps):</span>
        {NUDGE_BUTTONS.map(([direction, text, label]) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            title={label}
            onClick={(e) => onNudge(direction, e.shiftKey || e.detail > 1)}
          >
            {text}
          </button>
        ))}
      </div>
    </>
  );
}

type NudgeDirection = 'left' | 'right' | 'narrower' | 'wider';

const NUDGE_BUTTONS: [NudgeDirection, string, string][] = [
  ['left', '←', 'Move spine left'],
  ['right', '→', 'Move spine right'],
  ['narrower', '→←', 'Make spine narrower'],
  ['wider', '←→', 'Make spine wider'],
];

const NUDGE_KEYS: Record<string, NudgeDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'wider',
  ArrowDown: 'narrower',
};

/** Moves or resizes a spine by one nudge step, or returns null if it would get too thin. */
function nudgeSpine(spine: WrapSpine, direction: NudgeDirection, big: boolean): WrapSpine | null {
  const step = big ? SPINE_NUDGE * 10 : SPINE_NUDGE;
  const [dl, dr] = {
    left: [-step, -step],
    right: [step, step],
    narrower: [step / 2, -step / 2],
    wider: [-step / 2, step / 2],
  }[direction];
  const next = { left: spine.left + dl, right: spine.right + dr };
  return next.right - next.left >= 0.005 ? next : null;
}

interface CoverVariantsProps {
  book: Book;
  /** The variant in use, if the book's cover is one. */
  selected: number | null;
  onPick: (id: number) => void;
}

/** Thumbnails of the covers of the book's other editions on Open Library, to pick one instead. */
function CoverVariants({ book, selected, onPick }: CoverVariantsProps) {
  const [found, setFound] = useState<{ for: string; variants: CoverVariant[] | null }>({ for: '', variants: null });
  const variants = found.for === book.id ? found.variants : undefined;

  useEffect(() => {
    let current = true;
    lookupCoverVariants(book)
      .then((v) => current && setFound({ for: book.id, variants: v }))
      .catch(() => current && setFound({ for: book.id, variants: null }));
    return () => {
      current = false;
    };
    // Looked up once per book; the cache in lookupCoverVariants covers reopening it.
  }, [book.id]);

  return (
    <div className="variants">
      <span className="muted find">
        {variants === undefined
          ? 'Looking for covers of other editions...'
          : variants === null
            ? 'Could not reach Open Library for other editions.'
            : variants.length === 0
              ? 'Open Library has no other covers for this book.'
              : 'Covers from other editions. Tap one to use it.'}
      </span>
      {variants && variants.length > 0 && (
        <ul className="variant-strip">
          {variants.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                aria-pressed={selected === v.id}
                title={`${v.year ? `${v.year} edition` : 'Edition'}${v.english ? '' : ', not in English'}`}
                onClick={() => onPick(v.id)}
              >
                <img src={idThumbUrl(v.id)} alt={v.year ? `Cover from ${v.year}` : 'Cover'} loading="lazy" />
                <span>{v.year}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Arrow-key step for the spine, as a fraction of the artwork's width (half a pixel on a 1000 px image). */
const SPINE_NUDGE = 0.0005;

const NO_CROP: Crop = { top: 0, right: 0, bottom: 0, left: 0 };

interface CropControlsProps {
  /** A trim set by hand, which overrides the detected one. */
  manual: Crop | undefined;
  detected: Crop | null | undefined;
  onChange: (crop: Crop | undefined) => void;
}

function CropControls({ manual, detected, onChange }: CropControlsProps) {
  const crop = manual ?? detected ?? NO_CROP;
  const edge = (key: keyof Crop, label: string) => (
    <label>
      {label}: {(crop[key] * 100).toFixed(1)}%
      <input
        type="range"
        min={0}
        max={0.25}
        step={0.0025}
        value={crop[key]}
        onChange={(e) => onChange({ ...crop, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <fieldset className="crop">
      <legend>Trim edges (borders, stray lines)</legend>
      <span className="muted find crop-note">
        {manual
          ? 'Trim set by hand.'
          : detected
            ? 'A stray border was found and trimmed automatically.'
            : 'No stray border found.'}{' '}
        {manual && (
          <button className="link" onClick={() => onChange(undefined)}>
            Back to automatic
          </button>
        )}
      </span>
      {edge('top', 'Top')}
      {edge('bottom', 'Bottom')}
      {edge('left', 'Left')}
      {edge('right', 'Right')}
    </fieldset>
  );
}

export function BookList({
  books,
  listed,
  overrides,
  customCovers,
  settings,
  defaultWrapSpine,
  activeId,
  onActive,
  coverOf,
  onToggle,
  onCustomCover,
}: Props) {
  const [url, setUrl] = useState('');
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState('');
  const list = useRef<HTMLUListElement>(null);

  // Arrow keys nudge the active wrap's spine: left/right move it, up/down widen or narrow it.
  useEffect(() => {
    const book = listed.find((b) => b.id === activeId);
    const custom = book && customCovers[book.id];
    const cover = book && coverOf(book);
    if (!book || !custom?.wrap || cover?.source !== 'wrap') return;
    const spine = custom.spine ?? cover.detectedSpine ?? defaultWrapSpine;

    const onKey = (e: KeyboardEvent) => {
      // Arrow keys already mean something inside text boxes, sliders and dropdowns.
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      const direction = NUDGE_KEYS[e.key];
      if (!direction) return;
      e.preventDefault();
      const next = nudgeSpine(spine, direction, e.shiftKey);
      if (next) onCustomCover(book.id, { ...custom, spine: next });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The active card moves onto a row of its own, so bring it back into view.
  useEffect(() => {
    list.current?.querySelector('.book.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const listedIds = new Set(listed.map((b) => b.id));
  const q = query.trim().toLowerCase();
  const matches = q
    ? books.filter((b) => !listedIds.has(b.id) && `${b.title} ${b.authors}`.toLowerCase().includes(q)).slice(0, 8)
    : [];
  const included = listed.filter((b) => overrides[b.id] !== false).length;

  function activate(b: Book) {
    if (activeId === b.id) {
      onActive(null);
      return;
    }
    const custom = customCovers[b.id];
    setUrl(!custom || custom.url.startsWith('data:') ? '' : custom.url);
    setWrap(custom?.wrap ?? false);
    onActive(b.id);
  }

  return (
    <div className="booklist">
      <header className="booklist-head">
        <h2>
          Books <span className="muted">{included} on the sheet</span>
        </h2>
        <div className="add-missed">
          <input
            type="search"
            aria-label="Add a book the filters missed"
            placeholder="Add a book the filters missed: search your library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {q && matches.length === 0 && <p className="muted">Nothing else in your library matches.</p>}
          {matches.length > 0 && (
            <ul className="matches">
              {matches.map((b) => (
                <li key={b.id}>
                  <span>
                    <strong>{b.title}</strong> <span className="muted">{b.authors}</span>
                  </span>
                  <button onClick={() => onToggle(b.id, true)}>Add</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {listed.length === 0 && <p className="muted">No books match these filters.</p>}
      <ul className="rows" ref={list}>
        {listed.map((b) => {
          const cover = coverOf(b);
          const custom = customCovers[b.id];
          const active = activeId === b.id;
          const on = overrides[b.id] !== false;
          return (
            <li key={b.id} className={`book${active ? ' active' : ''}${on ? '' : ' off'}`}>
              <div
                className="book-head"
                role="button"
                tabIndex={0}
                aria-expanded={active}
                onClick={() => activate(b)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    activate(b);
                  }
                }}
              >
                <input
                  type="checkbox"
                  aria-label={`Include ${b.title} on the sheet`}
                  checked={on}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onToggle(b.id, e.target.checked)}
                />
                <Label book={b} cover={cover} custom={custom} settings={settings} thumbHeight={110} />
                <div className="book-text">
                  <strong>{b.title}</strong>
                  <span className="muted">{b.authors}</span>
                  <span className="book-meta">
                    {b.rating !== null && <span className="muted">{b.rating} stars</span>}
                    <span className={`badge ${cover?.source ?? 'loading'}`}>
                      {!cover
                        ? 'loading cover'
                        : cover.source === 'custom' && custom && coverIdFromUrl(custom.url)
                          ? 'other edition'
                          : BADGE[cover.source]}
                    </span>
                  </span>
                </div>
                <span className="book-hint">{active ? 'Done' : 'Edit cover'}</span>
              </div>

              {active && (
                <div className="cover-edit">
                  <CoverVariants
                    book={b}
                    selected={custom && !custom.wrap ? coverIdFromUrl(custom.url) : null}
                    onPick={(id) => {
                      setWrap(false);
                      setUrl('');
                      onCustomCover(b.id, { url: idCoverUrl(id), wrap: false });
                    }}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={wrap}
                      onChange={(e) => {
                        setWrap(e.target.checked);
                        if (custom) onCustomCover(b.id, { ...custom, wrap: e.target.checked });
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
                  {custom && cover?.image && (
                    <span className="muted find">
                      {cover.upgraded === 'original' && "Upgraded to Pinterest's original upload: "}
                      {cover.upgraded === 'larger' && "Upgraded to Pinterest's larger 1200 px copy: "}
                      {!cover.upgraded && 'Image loaded: '}
                      {cover.image.naturalWidth} x {cover.image.naturalHeight} px.
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void fileToDataUrl(file).then((dataUrl) => onCustomCover(b.id, { url: dataUrl, wrap }));
                    }}
                  />
                  {custom?.wrap && cover?.source === 'wrap' && (
                    <SpineControls
                      spine={custom.spine ?? cover.detectedSpine ?? defaultWrapSpine}
                      from={cover.spineFrom}
                      pages={cover.pages}
                      manual={Boolean(custom.spine)}
                      onChange={(spine) => onCustomCover(b.id, { ...custom, spine })}
                      onNudge={(direction, big) => {
                        const next = nudgeSpine(
                          custom.spine ?? cover.detectedSpine ?? defaultWrapSpine,
                          direction,
                          big,
                        );
                        if (next) onCustomCover(b.id, { ...custom, spine: next });
                      }}
                    />
                  )}
                  {custom && (
                    <CropControls
                      manual={custom.crop}
                      detected={cover?.detectedCrop}
                      onChange={(crop) => onCustomCover(b.id, { ...custom, crop })}
                    />
                  )}
                  {custom && (
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
    </div>
  );
}
