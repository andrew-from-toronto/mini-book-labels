import { lazy, Suspense, useEffect, useState } from 'react';
import { FILAMENTS, filamentById, isDark } from '../lib/filaments';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { decodeOrder, encodeOrder } from '../lib/orderCode';
import { bookBreakdown, formatCad, handlingBreakdown, MAX_QUANTITY, priceOrder, type PriceLine } from '../lib/pricing';
import { dimsAtScale, matchingScale, SCALES, type Dims } from '../lib/scales';
import { printable, PRINTABLE_HEIGHT, PRINTABLE_SPINE, PRINTABLE_WIDTH, shopVisible } from '../lib/shop';
import type { HookPosition, HookSide, ModelOptions } from '../lib/types';
import { HoleSelect } from './HoleSelect';
import { PaymentStep } from './PaymentStep';

const Book3D = lazy(() => import('./Book3D'));

/** The book and quantity from the address, or the designer's defaults. */
function fromAddress() {
  const params = new URLSearchParams(location.search);
  const order = decodeOrder(params.get('code') ?? '');
  const quantity = Math.min(MAX_QUANTITY, Math.max(1, Math.floor(Number(params.get('qty'))) || 5));
  const colour = order && FILAMENTS.some((f) => f.available && f.id === order.colour) ? order.colour : FILAMENTS.find((f) => f.available)!.id;
  return {
    dims: order && printable(order.dims) ? order.dims : { height: DEFAULT_SETTINGS.height, width: DEFAULT_SETTINGS.width, spine: DEFAULT_SETTINGS.spine },
    model: order?.options ?? DEFAULT_SETTINGS.model,
    colour,
    quantity,
  };
}

const mm = (v: number) => `${Number(v.toFixed(1))}`;

/** Each must be ticked before shipping and payment. */
const CONFIRMATIONS = [
  'I confirm the size and colour are correct.',
  "I understand these are made to order and can't be returned.",
  'I understand 3D printed items have small imperfections, such as faint layer lines and minor surface marks.',
];

/** "1:7 labels, 30 × 45 mm", or "custom labels" for sizes that are not a preset. */
function describeFit(dims: Dims): string {
  const ratio = matchingScale(dims);
  const label = `${mm(dims.height)} × ${mm(2 * dims.width + dims.spine)} mm`;
  return `${ratio ? `1:${ratio}` : 'custom'} labels, ${label}`;
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

/** Ordering blanks, on its own page: check the book, its colour and quantity, confirm, then shipping and payment. */
export function OrderPage() {
  const [initial] = useState(fromAddress);
  const [dims, setDims] = useState<Dims>(initial.dims);
  const [model, setModelOptions] = useState<ModelOptions>(initial.model);
  const [colour, setColour] = useState(initial.colour);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [confirmed, setConfirmed] = useState<boolean[]>(CONFIRMATIONS.map(() => false));
  const [step, setStep] = useState<'review' | 'pay'>('review');
  const allConfirmed = confirmed.every(Boolean);
  const settings = { ...DEFAULT_SETTINGS, ...dims, model };
  const order = priceOrder(dims, quantity);
  const code = encodeOrder({ dims, options: model, colour });

  // A changed choice needs confirming again.
  useEffect(() => setConfirmed(CONFIRMATIONS.map(() => false)), [colour, quantity, code]);
  // Keep the address current, so a reload or a shared link shows the same book.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set('code', code);
    params.set('qty', String(quantity));
    history.replaceState(null, '', `?${params}`);
  }, [code, quantity]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const ratio = matchingScale(dims);
  const setModel = (patch: Partial<ModelOptions>) => setModelOptions((m) => ({ ...m, ...patch }));
  // Custom: the size typed in, in mm. It's used once it's one we print; until then the last good size stays.
  const [custom, setCustom] = useState(() => !matchingScale(initial.dims));
  const [draft, setDraft] = useState(() => ({ height: String(initial.dims.height), width: String(initial.dims.width), spine: String(initial.dims.spine) }));
  const tenth = (v: string) => Math.round(Number(v) * 10) / 10;
  const drafted = { height: tenth(draft.height), width: tenth(draft.width), spine: tenth(draft.spine) };
  const draftOk = custom ? printable(drafted) : true;
  const setScale = (value: string) => {
    if (value === 'custom') {
      setCustom(true);
      setDraft({ height: String(dims.height), width: String(dims.width), spine: String(dims.spine) });
      return;
    }
    setCustom(false);
    setDims(dimsAtScale(Number(value)));
  };
  const setDraftSize = (field: keyof Dims, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    const size = { height: tenth(next.height), width: tenth(next.width), spine: tenth(next.spine) };
    if (printable(size)) setDims(size);
  };

  if (!shopVisible()) {
    return (
      <main className="order-page">
        <p>
          Blanks are not for sale yet. <a href="/">Back to the designer</a>
        </p>
      </main>
    );
  }

  return (
    <main className="order-page">
      <div className="order-main">
        <header className="order-header">
          <a href="/" className="brand">
            <img src="/favicon.svg" alt="" width={30} height={30} />
            Mini Book Labels
          </a>
          <a href="/about/" className="order-about">
            About
          </a>
        </header>
        <h1 className="order-title">Order blanks</h1>
        {/* Shipping and payment start loading, out of sight, once everything is ticked, so they are ready on
            Continue. A changed choice clears the ticks, which drops them, so they always match the order. */}
        {(allConfirmed || step === 'pay') && (
          <div className={step === 'pay' ? 'order-details' : 'order-details preparing'} inert={step !== 'pay'}>
            <PaymentStep code={code} quantity={quantity} onBack={() => setStep('review')} />
          </div>
        )}
        {step === 'review' && (
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
            <div className="model-choices">
              <label>
                Size
                <select value={custom || !ratio ? 'custom' : String(ratio)} onChange={(e) => setScale(e.target.value)}>
                  {SCALES.filter(({ ratio: r }) => printable(dimsAtScale(r))).map(({ ratio: r, note }) => {
                    const d = dimsAtScale(r);
                    return (
                      <option key={r} value={r}>
                        1:{r} · {mm(d.height)} × {mm(d.width)} × {mm(d.spine)} mm{note ? ` (${note})` : ''}
                      </option>
                    );
                  })}
                  <option value="custom">Custom</option>
                </select>
              </label>
              {custom && (
                <div className="row custom-size">
                  <label>
                    Height (mm)
                    <input
                      type="number"
                      inputMode="decimal"
                      min={PRINTABLE_HEIGHT.min}
                      max={PRINTABLE_HEIGHT.max}
                      step={0.1}
                      value={draft.height}
                      onChange={(e) => setDraftSize('height', e.target.value)}
                    />
                  </label>
                  <label>
                    Width (mm)
                    <input
                      type="number"
                      inputMode="decimal"
                      min={PRINTABLE_WIDTH.min}
                      max={PRINTABLE_WIDTH.max}
                      step={0.1}
                      value={draft.width}
                      onChange={(e) => setDraftSize('width', e.target.value)}
                    />
                  </label>
                  <label>
                    Spine (mm)
                    <input
                      type="number"
                      inputMode="decimal"
                      min={PRINTABLE_SPINE.min}
                      max={PRINTABLE_SPINE.max}
                      step={0.1}
                      value={draft.spine}
                      onChange={(e) => setDraftSize('spine', e.target.value)}
                    />
                  </label>
                </div>
              )}
              {!draftOk && (
                <p className="error">
                  Height {PRINTABLE_HEIGHT.min}-{PRINTABLE_HEIGHT.max} mm, width {PRINTABLE_WIDTH.min}-{PRINTABLE_WIDTH.max} mm
                  and no more than the height, spine {PRINTABLE_SPINE.min}-{PRINTABLE_SPINE.max} mm.
                </p>
              )}
              <p className="muted fits">Fits {describeFit(dims)}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={model.hook}
                  onChange={(e) => setModel({ hook: e.target.checked })}
                />
                Ornament hook
              </label>
              {model.hook && (
                <div className="row">
                  <label>
                    Hook
                    <select
                      value={model.hookPosition}
                      onChange={(e) => setModel({ hookPosition: e.target.value as HookPosition })}
                    >
                      <option value="center">Centred</option>
                      <option value="spine">Spine corner</option>
                      <option value="fore-edge">Fore-edge corner</option>
                    </select>
                  </label>
                  <label>
                    Side
                    <select
                      value={model.hookSide}
                      onChange={(e) => setModel({ hookSide: e.target.value as HookSide })}
                    >
                      <option value="front">Front</option>
                      <option value="back">Back</option>
                    </select>
                  </label>
                </div>
              )}
              {model.hook && <HoleSelect options={model} onChange={setModel} />}
              <label>
                Spine
                <select
                  value={model.roundSpine ? 'round' : 'flat'}
                  onChange={(e) => setModel({ roundSpine: e.target.value === 'round' })}
                >
                  <option value="flat">Flat</option>
                  <option value="round">Rounded</option>
                </select>
              </label>
            </div>
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
                <strong>{formatCad(order.subtotal)} CAD</strong> plus shipping
              </summary>
              <table className="price-breakdown">
                <Breakdown lines={bookBreakdown(dims)} total={order.unitPrice} label="Each blank" />
                <Breakdown lines={handlingBreakdown()} total={order.handling} label="Packing" />
                <tfoot>
                  <tr>
                    <th scope="row">
                      Total <span>{quantity === 1 ? '1 blank' : `${quantity} blanks`} + packing</span>
                    </th>
                    <td>{formatCad(order.subtotal)} CAD</td>
                  </tr>
                </tfoot>
              </table>
            </details>
            <div className="confirmations">
              {CONFIRMATIONS.map((text, i) => (
                <label key={text} className="check confirm">
                  <input
                    type="checkbox"
                    checked={confirmed[i]}
                    onChange={(e) => setConfirmed((c) => c.map((v, k) => (k === i ? e.target.checked : v)))}
                  />
                  {text}
                </label>
              ))}
            </div>
            <button type="button" className="primary" disabled={!allConfirmed || !draftOk} onClick={() => setStep('pay')}>
              Continue to shipping
            </button>
          </div>
        )}
      </div>
      {/* A dark filament gets a light backdrop, in either theme, so it stays visible. */}
      <aside className={isDark(filamentById(colour)?.swatch ?? '#ffffff') ? 'order-preview on-light' : 'order-preview'}>
        <Suspense fallback={<p className="muted">Loading preview...</p>}>
          <Book3D book={undefined} cover={undefined} custom={undefined} settings={settings} filament={filamentById(colour)?.swatch} measures refitOnResize />
        </Suspense>
      </aside>
    </main>
  );
}
