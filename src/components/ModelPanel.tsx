import { useState } from 'react';
import type { HookPosition, HookSide, ModelOptions } from '../lib/bookModel';
import { downloadModel, type ModelFormat } from '../lib/modelDownload';
import { costOfBook, formatCad } from '../lib/pricing';
import { orderUrl, PRINTABLE_HEIGHT, printable, shopVisible } from '../lib/shop';
import type { Dims } from '../lib/scales';
import type { Settings } from '../lib/types';
import { encodeOrder } from '../lib/orderCode';
import { HoleSelect } from './HoleSelect';
import { DEFAULT_FILAMENT } from '../lib/filaments';

type Format = ModelFormat;

interface Props {
  dims: Dims;
  options: ModelOptions;
  /** The label settings: the order page starts from this size and design. */
  settings: Settings;
  onChange: (options: ModelOptions) => void;
  /** Shows the book in the preview's 3D view; `openTab` also brings the preview forward on a phone. */
  onShow3d: (openTab: boolean) => void;
}

/** Free 3MF or STL of a hardcover mini book sized to the current label, built in the browser. */
export function ModelPanel({ dims, options, settings, onChange, onShow3d }: Props) {
  const [building, setBuilding] = useState<Format | null>(null);
  const [failed, setFailed] = useState(false);
  // Changing an option shows the result, so the hook or spine can be seen as it is set.
  const set = (patch: Partial<ModelOptions>) => {
    onChange({ ...options, ...patch });
    onShow3d(false);
  };

  async function download(format: Format) {
    setBuilding(format);
    setFailed(false);
    try {
      await downloadModel(dims, options, format);
    } catch {
      setFailed(true);
    } finally {
      setBuilding(null);
    }
  }

  return (
    <div className="fields">
      <p className="muted">
        A free hardcover book to print and wrap your labels around, sized to the label: {dims.height} x {dims.width} mm
        covers with a {dims.spine} mm spine.
      </p>
      <label className="check">
        <input type="checkbox" checked={options.hook} onChange={(e) => set({ hook: e.target.checked })} />
        Ornament hook on top
      </label>
      {options.hook && (
        <div className="row">
          <label>
            Hook along the top
            <select
              value={options.hookPosition}
              onChange={(e) => set({ hookPosition: e.target.value as HookPosition })}
            >
              <option value="center">Centred</option>
              <option value="spine">Spine corner</option>
              <option value="fore-edge">Fore-edge corner</option>
            </select>
          </label>
          <label>
            Flush with
            <select value={options.hookSide} onChange={(e) => set({ hookSide: e.target.value as HookSide })}>
              <option value="front">Front cover</option>
              <option value="back">Back cover</option>
            </select>
          </label>
        </div>
      )}
      {options.hook && <HoleSelect options={options} onChange={set} />}
      <label className="check">
        <input type="checkbox" checked={options.roundSpine} onChange={(e) => set({ roundSpine: e.target.checked })} />
        Slightly rounded spine (flat prints best)
      </label>
      <button onClick={() => onShow3d(true)}>View in 3D</button>
      <div className="row">
        <button className="grow" onClick={() => void download('3mf')} disabled={building !== null}>
          {building === '3mf' ? 'Building model' : 'Download 3MF'}
        </button>
        <button onClick={() => void download('stl')} disabled={building !== null} title="For slicers without 3MF support">
          {building === 'stl' ? 'Building' : 'STL'}
        </button>
      </div>
      {failed && <p className="error">Could not build the model in this browser.</p>}
      {shopVisible() && <BuyBlanks settings={settings} />}
      <p className="muted find">
        Print it lying on its {options.hook && options.hookSide === 'back' ? 'back' : 'front'} cover, as the file is
        laid out; it needs no supports. 3MF is the better format for current slicers (Orca, Bambu, Prusa, Elegoo);
        STL is there for older ones.
      </p>
    </div>
  );
}

/** A parcel, for blanks posted to the buyer. Drawn in the accent colours, so it follows the theme. */
function ParcelIcon() {
  return (
    <svg className="parcel-icon" viewBox="0 0 32 32" width={30} height={30} aria-hidden="true">
      <path className="top" d="M16 3 29 9.5 16 16 3 9.5Z" />
      <path className="left" d="M3 9.5 16 16v13L3 22.5Z" />
      <path className="right" d="M29 9.5 16 16v13l13-6.5Z" />
      <path className="tape" d="M9.5 6.25 22.5 12.75v5.5" />
    </svg>
  );
}

/** The blanks offer: opens the order page in a new tab, starting from this book. */
function BuyBlanks({ settings }: { settings: Settings }) {
  const dims = { height: settings.height, width: settings.width, spine: settings.spine };
  if (!printable(dims)) {
    return (
      <p className="muted find">
        Blanks are made from {PRINTABLE_HEIGHT.min} to {PRINTABLE_HEIGHT.max} mm tall; download the model to print
        this size yourself.
      </p>
    );
  }
  return (
    <div className="buy-blanks">
      <div className="buy-head">
        <ParcelIcon />
        <p>
          <strong>No 3D printer?</strong>
          <span>Order this model, blank, and ready to apply your covers.</span>
          <span className="buy-each">{formatCad(costOfBook(dims).unitPrice)} CAD each</span>
        </p>
      </div>
      <a
        className="button primary buy-cta"
        href={orderUrl(encodeOrder({ dims, options: settings.model, colour: DEFAULT_FILAMENT }))}
        target="_blank"
        rel="noopener"
      >
        Order blanks
      </a>
    </div>
  );
}
