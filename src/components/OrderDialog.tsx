import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { FILAMENTS, filamentById, isDark } from '../lib/filaments';
import { encodeOrder } from '../lib/orderCode';
import { bookBreakdown, formatCad, handlingBreakdown, MAX_QUANTITY, priceOrder, type PriceLine } from '../lib/pricing';
import { matchingScale, type Dims } from '../lib/scales';
import type { ModelOptions, Settings } from '../lib/types';

const Book3D = lazy(() => import('./Book3D'));

interface Props {
  settings: Settings;
  onClose: () => void;
}

const mm = (v: number) => `${Number(v.toFixed(1))}`;

/** "Flat spine · Hook centred, front": the design choices, as a buyer reads them. */
function describeOptions(o: ModelOptions): string {
  const spine = o.roundSpine ? 'Rounded spine' : 'Flat spine';
  if (!o.hook) return `${spine} · No hook`;
  const where = { center: 'centred', spine: 'spine corner', 'fore-edge': 'fore-edge corner' }[o.hookPosition];
  return `${spine} · Hook ${where}, ${o.hookSide}`;
}

/** "1:7 labels · 30 × 45 mm", or "Custom labels" for sizes that are not a preset. */
function describeFit(dims: Dims): string {
  const ratio = matchingScale(dims);
  const label = `${mm(dims.height)} × ${mm(2 * dims.width + dims.spine)} mm`;
  return `${ratio ? `1:${ratio}` : 'Custom'} labels · ${label}`;
}

/** A group of a price breakdown: its total first, then the parts it is made of. */
function Breakdown({ lines, total, label }: { lines: PriceLine[]; total: number; label: string }) {
  return (
    <tbody>
      <tr className="group">
        <th scope="row">{label}</th>
        <td>{formatCad(total)}</td>
      </tr>
      {lines.map((line) => (
        <tr key={line.label} className={line.label === 'Margin' ? 'part margin' : 'part'}>
          <td>{line.label}</td>
          <td>{formatCad(line.cents)}</td>
        </tr>
      ))}
    </tbody>
  );
}

/** Ordering blanks: check the book, its colour and quantity, confirm, then shipping and payment. */
export function OrderDialog({ settings, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [colour, setColour] = useState(FILAMENTS.find((f) => f.available)!.id);
  const [quantity, setQuantity] = useState(5);
  const [confirmed, setConfirmed] = useState(false);
  const dims = { height: settings.height, width: settings.width, spine: settings.spine };
  const order = priceOrder(dims, quantity);
  const code = encodeOrder({ dims, options: settings.model, colour });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // A changed choice needs confirming again.
  useEffect(() => setConfirmed(false), [colour, quantity]);

  return (
    <dialog ref={dialog} className="order-dialog" onClose={onClose} aria-labelledby="order-title">
      <header>
        <h2 id="order-title">Order blanks</h2>
        <button type="button" className="close" onClick={() => dialog.current?.close()} aria-label="Close">
          ×
        </button>
      </header>
      <div className="order-body">
        {/* A dark filament gets a light backdrop, in either theme, so it stays visible. */}
        <div className={isDark(filamentById(colour)?.swatch ?? '#ffffff') ? 'order-preview on-light' : 'order-preview'}>
          <Suspense fallback={<p className="muted">Loading preview...</p>}>
            <Book3D book={undefined} cover={undefined} custom={undefined} settings={settings} filament={filamentById(colour)?.swatch} />
          </Suspense>
        </div>
        <div className="order-details">
          <fieldset className="colours">
            <legend>Colour</legend>
            {FILAMENTS.filter((f) => f.available).map((f) => (
              <label key={f.id} className="swatch">
                <input type="radio" name="colour" value={f.id} checked={colour === f.id} onChange={() => setColour(f.id)} />
                <span style={{ background: f.swatch }} aria-hidden="true" />
                {f.name}
              </label>
            ))}
          </fieldset>
          <dl className="spec">
            <dt>Size</dt>
            <dd>
              {mm(dims.height)} × {mm(dims.width)} × {mm(dims.spine)} mm
            </dd>
            <dt>Fits</dt>
            <dd>{describeFit(dims)}</dd>
            <dt>Design</dt>
            <dd>{describeOptions(settings.model)}</dd>
          </dl>
          <label className="buy-quantity">
            Quantity
            <input
              type="number"
              min={1}
              max={MAX_QUANTITY}
              value={quantity}
              onChange={(e) =>
                setQuantity(Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(e.target.value)) || 1)))
              }
            />
          </label>
          <details className="price-detail">
            <summary>
              <strong>{formatCad(order.subtotal)}</strong> plus shipping
            </summary>
            <table className="price-breakdown">
              <Breakdown lines={bookBreakdown(dims)} total={order.unitPrice} label="Each blank" />
              <Breakdown lines={handlingBreakdown()} total={order.handling} label="Packing" />
              <tfoot>
                <tr>
                  <th scope="row">
                    Total <span>{quantity === 1 ? '1 blank' : `${quantity} blanks`} + packing</span>
                  </th>
                  <td>{formatCad(order.subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </details>
          <label className="check confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm the size and colour are correct. I understand these are made to order and can't be returned.
          </label>
          <button type="button" className="primary" disabled={!confirmed} title={code}>
            Continue to shipping
          </button>
        </div>
      </div>
    </dialog>
  );
}
