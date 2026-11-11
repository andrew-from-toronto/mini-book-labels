import { useState } from 'react';
import {
  buildBookMesh,
  meshToStl,
  modelFileName,
  type HookPosition,
  type HookSide,
  type ModelOptions,
} from '../lib/bookModel';
import { saveFile } from '../lib/download';
import { encodeOrder } from '../lib/orderCode';
import { checkoutUrl, shopOpen, tierFor } from '../lib/shop';
import type { Dims } from '../lib/scales';
import { meshTo3mf } from '../lib/threeMf';

type Format = '3mf' | 'stl';

interface Props {
  dims: Dims;
  options: ModelOptions;
  onChange: (options: ModelOptions) => void;
  /** Shows the book in the preview's 3D view; `openTab` also brings the preview forward on a phone. */
  onShow3d: (openTab: boolean) => void;
}

/** Free 3MF or STL of a hardcover mini book sized to the current label, built in the browser. */
export function ModelPanel({ dims, options, onChange, onShow3d }: Props) {
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
      const mesh = await buildBookMesh(dims, options, true);
      const name = modelFileName(dims, options, format);
      if (format === '3mf') {
        const title = `Mini book ${dims.height} x ${dims.width} x ${dims.spine} mm`;
        saveFile(meshTo3mf(mesh, title), name, 'model/3mf');
      } else {
        saveFile(meshToStl(mesh), name, 'model/stl');
      }
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
      {shopOpen() && <BuyBlanks dims={dims} options={options} />}
      <p className="muted find">
        Print it lying on its {options.hook && options.hookSide === 'back' ? 'back' : 'front'} cover, as the file is
        laid out; it needs no supports. 3MF is the better format for current slicers (Orca, Bambu, Prusa, Elegoo);
        STL is there for older ones.
      </p>
    </div>
  );
}

/** Printed blank books of exactly this size and design, paid for through Stripe. */
function BuyBlanks({ dims, options }: { dims: Dims; options: ModelOptions }) {
  const tier = tierFor(dims);
  if (!tier) {
    return (
      <p className="muted find">
        Printed books go up to 60 mm tall; this one is bigger, so download the model to print it yourself.
      </p>
    );
  }
  return (
    <div className="buy-blanks">
      <p>
        <strong>No 3D printer?</strong> Buy this book printed: {tier.label.toLowerCase()} size, {tier.price} each, ready
        for your covers.
      </p>
      <a className="button primary" href={checkoutUrl(tier, encodeOrder({ dims, options }))}>
        Buy printed blanks
      </a>
      <p className="muted find">Checkout is by Stripe. You choose how many and where to ship there.</p>
    </div>
  );
}
