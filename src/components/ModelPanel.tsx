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
import { bookBreakdown, formatCad, handlingBreakdown, MAX_QUANTITY, priceOrder, type PriceLine } from '../lib/pricing';
import { PRINTABLE_HEIGHT, printable, shopVisible } from '../lib/shop';
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
      {shopVisible() && <BuyBlanks dims={dims} options={options} />}
      <p className="muted find">
        Print it lying on its {options.hook && options.hookSide === 'back' ? 'back' : 'front'} cover, as the file is
        laid out; it needs no supports. 3MF is the better format for current slicers (Orca, Bambu, Prusa, Elegoo);
        STL is there for older ones.
      </p>
    </div>
  );
}

/** Rows of a price breakdown, then its total. */
function Breakdown({ lines, total, label }: { lines: PriceLine[]; total: number; label: string }) {
  return (
    <>
      {lines.map((line) => (
        <tr key={line.label} className={line.label.startsWith('Margin') ? 'margin' : undefined}>
          <td>{line.label}</td>
          <td>{formatCad(line.cents)}</td>
        </tr>
      ))}
      <tr className="subtotal">
        <th scope="row">{label}</th>
        <td>{formatCad(total)}</td>
      </tr>
    </>
  );
}

/**
 * Printed blank books of exactly this size and design. The price is shown openly, line by line,
 * margin included: printed books are how the free label maker pays for itself.
 */
function BuyBlanks({ dims, options }: { dims: Dims; options: ModelOptions }) {
  const [quantity, setQuantity] = useState(5);
  if (!printable(dims)) {
    return (
      <p className="muted find">
        Printed books are made from {PRINTABLE_HEIGHT.min} to {PRINTABLE_HEIGHT.max} mm tall; download the model to
        print this size yourself.
      </p>
    );
  }
  const order = priceOrder(dims, quantity);
  const code = encodeOrder({ dims, options });
  return (
    <div className="buy-blanks">
      <p>
        <strong>No 3D printer?</strong> Order this model, blank, and ready to apply your covers.
      </p>
      <label>
        How many
        <input
          type="number"
          min={1}
          max={MAX_QUANTITY}
          value={quantity}
          onChange={(e) => setQuantity(Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(e.target.value)) || 1)))}
        />
      </label>
      <details className="price-detail">
        <summary>
          {quantity} x {formatCad(order.unitPrice)} + {formatCad(order.handling)} packing ={' '}
          <strong>{formatCad(order.subtotal)}</strong>, plus shipping
        </summary>
        <table className="price-breakdown">
          <caption>How the price adds up</caption>
          <tbody>
            <Breakdown lines={bookBreakdown(dims)} total={order.unitPrice} label="Each book" />
            <Breakdown lines={handlingBreakdown()} total={order.handling} label="Packing, once per order" />
          </tbody>
        </table>
      </details>
      <p className="muted find">
        The covers and the 3D model stay free. Printed books carry a margin, shown above, which pays for the time to
        make and post them and keeps this site running.
      </p>
      <button className="primary" disabled title={`Order ${code}`}>
        Checkout opens soon
      </button>
    </div>
  );
}
