import { lazy, Suspense, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { filamentById, isDark } from '../lib/filaments';
import { decodeOrder } from '../lib/orderCode';
import { formatCad } from '../lib/pricing';

const Book3D = lazy(() => import('./Book3D'));

interface Address {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string;
}

/** An order as /api/admin/orders gives it (worker/admin.ts). */
interface Order {
  session_id: string;
  order_code: string;
  description: string;
  quantity: number;
  amount_total: number;
  email: string | null;
  name: string | null;
  address: Address | null;
  status: string;
  created_at: string;
  delivery: string | null;
  shipping_service: string | null;
  shipping_amount: number | null;
  chitchats_shipment_id: string | null;
  label_status: string | null;
  postage_type: string | null;
  postage_cost: string | null;
  tracking_code: string | null;
  tracking_url: string | null;
  label_pdf_url: string | null;
  shipped_at: string | null;
  shipped_emailed_at: string | null;
  tracking_checked_at: string | null;
  delivered_at: string | null;
}

interface Rate {
  postage_type: string;
  description: string;
  amount: number;
  days: { min: number; max: number } | null;
}

type Filter = 'to-do' | 'on-the-way' | 'delivered' | 'all';

const FILTERS: [Filter, string][] = [
  ['to-do', 'To do'],
  ['on-the-way', 'On the way'],
  ['delivered', 'Delivered'],
  ['all', 'All'],
];

/** To do: everything up to the label. On the way: labeled and shipped. */
const shown = (o: Order, f: Filter) =>
  f === 'all'
    ? true
    : f === 'to-do'
      ? ['paid', 'printing', 'packing'].includes(o.status)
      : f === 'on-the-way'
        ? ['labeled', 'shipped'].includes(o.status)
        : o.status === 'delivered';

/** SQLite "2026-11-11 17:19:05" (UTC) or an ISO time, in local time. */
const date = (when: string) =>
  new Date(when.includes('T') ? when : `${when.replace(' ', 'T')}Z`).toLocaleString('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Where an order is, in a word or two: its label before shipping, its tracking after. */
function orderState(o: Pick<Order, 'status' | 'label_status'>): string {
  if (o.status === 'delivered') return 'Delivered';
  if (o.status === 'labeled') return 'Labeled';
  if (o.status === 'shipped') {
    switch (o.label_status) {
      case 'exception':
        return 'Problem';
      case 'received':
      case 'released':
      case 'inducted':
      case 'in_transit':
      case 'resolved':
        return 'In transit';
      default:
        return 'Shipped';
    }
  }
  switch (o.label_status) {
    case 'postage_requested':
      return 'Buying label';
    case 'postage_purchase_failed':
      return 'Label failed';
    case 'voided':
      return 'Label voided';
    default:
      return { paid: 'New', printing: 'Printing', packing: 'Packing' }[o.status] ?? o.status;
  }
}

/** "2 days", "3-9 days". */
const days = ({ min, max }: { min: number; max: number }) => (min === max ? `${max} days` : `${min}-${max} days`);

const stateClass = (o: Order) => `admin-state state-${orderState(o).toLowerCase().replace(/\s+/g, '-')}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

/** Orders, and everything to fulfil one: the model, a Chit Chats label, shipping and tracking. */
export function AdminPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState<Filter>('to-do');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [chitchats, setChitchats] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api<{ orders: Order[]; chitchats: string }>('orders')
      .then((d) => {
        setOrders(d.orders);
        setChitchats(d.chitchats);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function checkTracking() {
    setChecking(true);
    setError('');
    try {
      setOrders((await api<{ orders: Order[] }>('tracking', {})).orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  const replace = (order: Order) => setOrders((list) => list?.map((o) => (o.session_id === order.session_id ? order : o)) ?? null);
  const list = orders?.filter((o) => shown(o, filter)) ?? [];
  const current = orders?.find((o) => o.session_id === selected) ?? null;

  return (
    <main className="admin-page">
      <aside className="admin-side">
        <header className="order-header">
          <a href="/" className="brand">
            <img src="/favicon.svg" alt="" width={30} height={30} />
            Mini Book Labels
          </a>
          {chitchats && (
            <span className={`chitchats-mode ${chitchats === 'live' ? 'live' : 'staging'}`}>
              Chit Chats {chitchats === 'live' ? 'live' : chitchats === 'staging' ? 'staging' : `error: ${chitchats}`}
            </span>
          )}
        </header>
        <div className="admin-filters" role="tablist">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {label} <span className="muted">{orders?.filter((o) => shown(o, f)).length ?? ''}</span>
            </button>
          ))}
        </div>
        <button type="button" disabled={checking || !orders} onClick={() => void checkTracking()}>
          {checking ? 'Checking...' : 'Refresh tracking'}
        </button>
        {error && <p className="error">{error}</p>}
        {!orders && !error && <p className="muted">Loading...</p>}
        {orders && list.length === 0 && <p className="muted">No orders.</p>}
        <ul className="admin-list">
          {list.map((o) => (
            <li key={o.session_id}>
              <button
                type="button"
                className={o.session_id === selected ? 'admin-row active' : 'admin-row'}
                onClick={() => setSelected(o.session_id)}
              >
                <span className="admin-row-top">
                  <strong>{o.name ?? o.email ?? 'Unknown'}</strong>
                  <span>{formatCad(o.amount_total)}</span>
                </span>
                <span className="muted">
                  {o.quantity} × {o.description}
                </span>
                <span className="admin-row-top muted">
                  <span>{date(o.created_at)}</span>
                  <span className={stateClass(o)}>{orderState(o)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="admin-main">
        {current ? (
          <OrderDetail key={current.session_id} order={current} onChange={replace} />
        ) : (
          <p className="muted admin-empty">Choose an order.</p>
        )}
      </section>
    </main>
  );
}

/** The book as ordered, in its filament, with measurements: what to print. */
function OrderPreview({ code }: { code: string }) {
  const order = decodeOrder(code);
  if (!order) return null;
  const swatch = filamentById(order.colour)?.swatch ?? '#ffffff';
  const settings = { ...DEFAULT_SETTINGS, ...order.dims, model: order.options };
  return (
    <div className={isDark(swatch) ? 'admin-preview on-light' : 'admin-preview'}>
      <Suspense fallback={<p className="muted">Loading preview...</p>}>
        <Book3D book={undefined} cover={undefined} custom={undefined} settings={settings} filament={swatch} measures />
      </Suspense>
    </div>
  );
}

/** The steps an order goes through; the first three are set by hand, the rest by the label and tracking. */
const STAGES: [string, string][] = [
  ['paid', 'New'],
  ['printing', 'Printing'],
  ['packing', 'Packing'],
  ['labeled', 'Labeled'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
];
const MANUAL = ['paid', 'printing', 'packing'];

/** The next step to press, for the stages set by hand. */
const NEXT: Record<string, [string, string]> = {
  paid: ['printing', 'Start printing'],
  printing: ['packing', 'Printed, start packing'],
};

function OrderDetail({ order: o, onChange }: { order: Order; onChange: (o: Order) => void }) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [service, setService] = useState(o.shipping_service ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'buy' | 'refund' | null>(null);
  const [error, setError] = useState('');

  async function run(action: string, body: unknown = {}) {
    setBusy(action);
    setError('');
    setConfirming(null);
    try {
      const data = await api<{ order: Order; rates?: Rate[] }>(`orders/${o.session_id}/${action}`, body);
      onChange(data.order);
      if (data.rates) {
        setRates(data.rates);
        // The buyer's service when it is offered, else the cheapest.
        if (!data.rates.some((r) => r.postage_type === service)) setService(data.rates[0]?.postage_type ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const a = o.address;
  const chosen = rates?.find((r) => r.postage_type === service);
  const manual = MANUAL.includes(o.status);
  const stageIndex = STAGES.findIndex(([s]) => s === o.status);
  const next = NEXT[o.status];
  const hasLabel = ['labeled', 'shipped', 'delivered'].includes(o.status);

  return (
    <div className="admin-order">
      <OrderPreview code={o.order_code} />

      <div className="admin-order-body">
        <h1 className="admin-title">{o.name ?? 'Order'}</h1>
        <p className="muted">
          {date(o.created_at)} · {formatCad(o.amount_total)} ·{' '}
          {o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : 'no email'}
        </p>

        <ol className="stages" aria-label="Order stage">
          {STAGES.map(([stage, label], i) => {
            const clickable = manual && MANUAL.includes(stage) && stage !== o.status;
            const state = i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'todo';
            return (
              <li key={stage} className={`stage ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                {clickable ? (
                  <button type="button" className="link" disabled={busy !== null} onClick={() => void run('stage', { stage })}>
                    {label}
                  </button>
                ) : (
                  <span>{orderState(o) === 'Problem' && stage === 'shipped' ? 'Problem' : label}</span>
                )}
              </li>
            );
          })}
        </ol>
        {next && (
          <button type="button" className="primary" disabled={busy !== null} onClick={() => void run('stage', { stage: next[0] })}>
            {busy === 'stage' ? 'Saving...' : next[1]}
          </button>
        )}

        <h2>Book</h2>
        <p>
          {o.quantity} × {o.description}
        </p>
        <p className="muted">
          <code>{o.order_code}</code>
        </p>
        <a className="button" href={`/model/?code=${encodeURIComponent(o.order_code)}`} target="_blank" rel="noopener">
          Download model
        </a>

        <h2>Ship to</h2>
        {a ? (
          <address>
            {o.name}
            <br />
            {a.line1}
            {a.line2 && (
              <>
                <br />
                {a.line2}
              </>
            )}
            <br />
            {[a.city, a.state, a.postal_code].filter(Boolean).join(' ')}
            <br />
            {a.country}
          </address>
        ) : (
          <p className="error">No address.</p>
        )}
        <p className="muted">
          Buyer chose {o.delivery ?? 'unknown'}
          {o.shipping_service ? ` (${o.shipping_service})` : ''}
          {o.shipping_amount != null ? `, paid ${formatCad(o.shipping_amount)}` : ''}
        </p>

        <h2>Label</h2>
        {hasLabel ? (
          <>
            <dl className="spec">
              <dt>Service</dt>
              <dd>{o.postage_type}</dd>
              {o.postage_cost && (
                <>
                  <dt>Cost</dt>
                  <dd>${o.postage_cost}</dd>
                </>
              )}
              {o.tracking_code && (
                <>
                  <dt>Tracking</dt>
                  <dd>{o.tracking_code}</dd>
                </>
              )}
            </dl>
            <div className="row">
              {o.label_pdf_url && (
                <a className="button primary" href={o.label_pdf_url} target="_blank" rel="noopener">
                  Print label
                </a>
              )}
              {o.tracking_url && (
                <a className="button" href={o.tracking_url} target="_blank" rel="noopener">
                  Tracking
                </a>
              )}
            </div>
            {o.status === 'labeled' &&
              (confirming === 'refund' ? (
                <div className="row">
                  <button type="button" className="danger" disabled={busy !== null} onClick={() => void run('refund')}>
                    Void label and request refund
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="link" disabled={busy !== null} onClick={() => setConfirming('refund')}>
                  Void label
                </button>
              ))}
          </>
        ) : o.status !== 'packing' ? (
          <p className="muted">Bought while packing.</p>
        ) : o.label_status === 'postage_requested' ? (
          <p>
            Chit Chats is still buying the label.{' '}
            <button type="button" className="link" disabled={busy !== null} onClick={() => void run('shipment')}>
              Check again
            </button>
          </p>
        ) : (
          <>
            {o.label_status === 'voided' && <p className="muted">The last label was voided.</p>}
            {rates ? (
              <fieldset className="shipping-options">
                <legend>Service</legend>
                {rates.map((r) => (
                  <label key={r.postage_type} className="shipping-option">
                    <input
                      type="radio"
                      name="service"
                      checked={service === r.postage_type}
                      onChange={() => {
                        setService(r.postage_type);
                        setConfirming(null);
                      }}
                    />
                    <span>
                      {r.description}
                      {r.postage_type === o.shipping_service && <span className="muted"> · buyer's choice</span>}
                    </span>
                    <span className="muted">{r.days ? days(r.days) : ''}</span>
                    <strong>
                      {formatCad(r.amount)}
                      {o.shipping_amount != null && r.amount > o.shipping_amount && (
                        <span className="over"> +{formatCad(r.amount - o.shipping_amount)}</span>
                      )}
                    </strong>
                  </label>
                ))}
              </fieldset>
            ) : (
              <button type="button" className="primary" disabled={busy !== null} onClick={() => void run('shipment')}>
                {busy === 'shipment' ? 'Getting rates...' : 'Get rates'}
              </button>
            )}
            {rates &&
              chosen &&
              (confirming === 'buy' ? (
                <div className="row">
                  <button type="button" className="primary" disabled={busy !== null} onClick={() => void run('buy', { postage_type: service })}>
                    {busy === 'buy' ? 'Buying...' : `Confirm: pay ${formatCad(chosen.amount)}`}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="primary" disabled={busy !== null} onClick={() => setConfirming('buy')}>
                  Buy label · {formatCad(chosen.amount)}
                </button>
              ))}
          </>
        )}

        {hasLabel && (
          <>
            <h2>Tracking</h2>
            <dl className="spec">
              <dt>Status</dt>
              <dd className={stateClass(o)}>{o.status === 'labeled' ? 'Waiting for Chit Chats' : orderState(o)}</dd>
              {o.shipped_at && (
                <>
                  <dt>Shipped</dt>
                  <dd>{date(o.shipped_at)}</dd>
                </>
              )}
              {o.delivered_at && (
                <>
                  <dt>Delivered</dt>
                  <dd>{date(o.delivered_at)}</dd>
                </>
              )}
              <dt>Buyer emailed</dt>
              <dd>{o.shipped_emailed_at ? date(o.shipped_emailed_at) : 'Not yet'}</dd>
              <dt>Checked</dt>
              <dd>{o.tracking_checked_at ? date(o.tracking_checked_at) : 'Not yet'}</dd>
            </dl>
            <button type="button" disabled={busy !== null} onClick={() => void run('track')}>
              {busy === 'track' ? 'Checking...' : 'Check now'}
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
