import { useEffect, useState } from 'react';
import { formatCad } from '../lib/pricing';

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
}

interface Rate {
  postage_type: string;
  description: string;
  amount: number;
  days: { min: number; max: number } | null;
}

type Filter = 'to-ship' | 'shipped' | 'all';

const FILTERS: [Filter, string][] = [
  ['to-ship', 'To ship'],
  ['shipped', 'Shipped'],
  ['all', 'All'],
];

const shown = (o: Order, f: Filter) =>
  f === 'all' ? true : f === 'shipped' ? o.status === 'shipped' : o.status === 'paid';

const date = (sqlite: string) =>
  new Date(`${sqlite.replace(' ', 'T')}Z`).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

/** A label's state in a word or two. */
function labelState(o: Order): string {
  if (o.status === 'shipped') return 'Shipped';
  switch (o.label_status) {
    case 'ready':
      return 'Label ready';
    case 'postage_requested':
      return 'Buying label';
    case 'postage_purchase_failed':
      return 'Label failed';
    case 'voided':
      return 'Label voided';
    default:
      return o.status === 'paid' ? 'Needs label' : o.status;
  }
}

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

/** Orders, and everything to fulfil one: the model, a Chit Chats label, and the shipped email. */
export function AdminPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState<Filter>('to-ship');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [chitchats, setChitchats] = useState('');

  useEffect(() => {
    api<{ orders: Order[]; chitchats: string }>('orders')
      .then((d) => {
        setOrders(d.orders);
        setChitchats(d.chitchats);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const replace = (order: Order) => setOrders((list) => list?.map((o) => (o.session_id === order.session_id ? order : o)) ?? null);
  const list = orders?.filter((o) => shown(o, filter)) ?? [];
  const current = orders?.find((o) => o.session_id === selected) ?? null;

  return (
    <main className="admin-page">
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
      <div className="admin-body">
        <section className="admin-list">
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
          {error && <p className="error">{error}</p>}
          {!orders && !error && <p className="muted">Loading...</p>}
          {orders && list.length === 0 && <p className="muted">No orders.</p>}
          <ul>
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
                    <span className={`admin-state state-${labelState(o).toLowerCase().replace(/\s+/g, '-')}`}>{labelState(o)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="admin-detail">
          {current ? <OrderDetail key={current.session_id} order={current} onChange={replace} /> : <p className="muted">Choose an order.</p>}
        </section>
      </div>
    </main>
  );
}

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
  const hasLabel = o.label_status === 'ready' || o.label_status === 'in_transit' || o.label_status === 'delivered';
  const shipped = o.status === 'shipped';

  return (
    <div className="admin-order">
      <h1 className="order-title">{o.name ?? 'Order'}</h1>
      <p className="muted">
        {date(o.created_at)} · {formatCad(o.amount_total)} ·{' '}
        {o.email ? <a href={`mailto:${o.email}`}>{o.email}</a> : 'no email'}
      </p>

      <h2>Book</h2>
      <p>
        {o.quantity} × {o.description}
      </p>
      <p className="muted">
        <code>{o.order_code}</code>
      </p>
      <p>
        <a className="button primary" href={`/model/?code=${encodeURIComponent(o.order_code)}`} target="_blank" rel="noopener">
          Download model
        </a>
      </p>

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
              <a className="button primary grow" href={o.label_pdf_url} target="_blank" rel="noopener">
                Print label
              </a>
            )}
            {o.tracking_url && (
              <a className="button" href={o.tracking_url} target="_blank" rel="noopener">
                Tracking
              </a>
            )}
          </div>
          {!shipped &&
            (confirming === 'refund' ? (
              <div className="row">
                <button type="button" className="danger grow" disabled={busy !== null} onClick={() => void run('refund')}>
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
                  <span className="muted">{r.days ? `${r.days.min}-${r.days.max} days` : ''}</span>
                  <strong>{formatCad(r.amount)}</strong>
                </label>
              ))}
            </fieldset>
          ) : (
            <button type="button" className="primary" disabled={busy !== null || shipped} onClick={() => void run('shipment')}>
              {busy === 'shipment' ? 'Getting rates...' : 'Get rates'}
            </button>
          )}
          {rates && chosen && (
            <div className="row">
              {confirming === 'buy' ? (
                <>
                  <button
                    type="button"
                    className="primary grow"
                    disabled={busy !== null}
                    onClick={() => void run('buy', { postage_type: service })}
                  >
                    {busy === 'buy' ? 'Buying...' : `Confirm: pay ${formatCad(chosen.amount)}`}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className="primary grow" disabled={busy !== null} onClick={() => setConfirming('buy')}>
                  Buy label · {formatCad(chosen.amount)}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <h2>Shipping</h2>
      {shipped ? (
        <p>
          Shipped {o.shipped_at ? date(o.shipped_at.replace('T', ' ').replace(/\.\d+Z$/, '')) : ''}
          {o.shipped_emailed_at ? '. Buyer emailed.' : '. Buyer not emailed.'}
        </p>
      ) : (
        <button type="button" className="primary" disabled={busy !== null || !hasLabel} onClick={() => void run('shipped')}>
          {busy === 'shipped' ? 'Marking...' : 'Mark shipped and email buyer'}
        </button>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
