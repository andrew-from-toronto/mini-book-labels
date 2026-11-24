import { useEffect, useState } from 'react';
import { api } from '../lib/adminApi';
import { formatCad } from '../lib/pricing';
import { AdminNav } from './AdminNav';
import { InfoTip } from './InfoTip';

type Row = Record<string, string | number | null>;
type Result = Row[] | { error: string };

interface Report {
  days: number;
  sections: { id: string; title: string }[];
  results: Record<string, Result>;
}

const PERIODS = [7, 30, 90];

const rows = (r: Result | undefined): Row[] => (Array.isArray(r) ? r : []);
const one = (r: Result | undefined) => Number(rows(r)[0]?.n ?? 0) || 0;
const errorOf = (r: Result | undefined) => (r && !Array.isArray(r) ? r.error : null);
const fmt = (n: number) => Math.round(n).toLocaleString('en-CA');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

/** Usage, from Analytics Engine (worker/usage.ts): the north star, the funnel, and what people choose. */
export function AdminUsage() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<Report | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api<Report | { missing: string[] }>(`usage?days=${days}`)
      .then((d) => ('missing' in d ? setMissing(d.missing) : setReport(d)))
      .catch((e: Error) => setError(e.message));
  }, [days]);

  const r = report?.results ?? {};
  const covers = { found: one(r['total.coversFound']), generated: one(r['total.coversGenerated']), replaced: one(r['total.coversReplaced']) };
  const coverTotal = covers.found + covers.generated + covers.replaced;
  const visitors = one(r['total.visitors']);
  const funnel: [string, number][] = [
    ['Opened the label maker', one(r['funnel.app'])],
    ['Got books in', one(r['funnel.books'])],
    ['Sent labels out', one(r['funnel.labels'])],
    ['Looked at the shop or model', one(r['funnel.shop'])],
    ['Started checkout', one(r['funnel.checkout'])],
    ['Paid', one(r['funnel.paid'])],
  ];

  return (
    <main className="admin-usage">
      <header className="admin-usage-head">
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          Mini Book Labels
        </a>
        <AdminNav current="usage" />
        <div className="view-toggle" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)}>
              {p} days
            </button>
          ))}
        </div>
      </header>

      {missing && (
        <section className="usage-card">
          <h2>Set up</h2>
          <p>The usage page needs a Cloudflare API token that can read Analytics Engine.</p>
          <ol>
            <li>Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token.</li>
            <li>Permissions: Account → Account Analytics → Read. Account resources: this account.</li>
            <li>
              Then run <code>npx wrangler secret put ANALYTICS_API_TOKEN</code> and paste it.
            </li>
          </ol>
          <p className="muted">Missing: {missing.join(', ')}</p>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {!report && !missing && !error && <p className="muted">Loading…</p>}

      {report && (
        <>
          <section className="usage-tiles" aria-label="Headline numbers">
            <Tile
              label="Labels delivered"
              value={fmt(one(r['total.labels']))}
              note={`${fmt(one(r['funnel.labels']))} visitors`}
              tip="Labels printed at home, or made into a print shop, Cricut or Silhouette file. The number to grow."
            />
            <Tile label="Visitors" value={fmt(visitors)} note={`${pct(one(r['total.returning']), visitors)} returning`} />
            <Tile label="Orders paid" value={fmt(one(r['total.orders']))} note={formatCad(one(r['total.revenue']))} />
            <Tile
              label="Covers found"
              tip="Of the labels delivered: covers looked up automatically, generated because none was found, or replaced by hand."
              value={pct(covers.found, coverTotal)}
              note={`${pct(covers.generated, coverTotal)} generated, ${pct(covers.replaced, coverTotal)} replaced`}
            />
          </section>

          <section className="usage-card">
            <h2>Labels delivered per day</h2>
            <DailyBars rows={rows(r.dailyLabels)} days={days} unit="labels" error={errorOf(r.dailyLabels)} />
          </section>
          <section className="usage-card">
            <h2>Visitors per day</h2>
            <DailyBars rows={rows(r.dailyVisitors)} days={days} unit="visitors" error={errorOf(r.dailyVisitors)} />
          </section>

          <section className="usage-card">
            <h2>Funnel</h2>
            <p className="muted">Visitors who did each, in this period.</p>
            <table className="usage-funnel">
              <tbody>
                {funnel.map(([label, n], i) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="usage-bar-cell">
                      <span className="usage-bar" style={{ width: `${funnel[0][1] ? (n / funnel[0][1]) * 100 : 0}%` }} title={`${fmt(n)} visitors`} />
                    </td>
                    <td className="num">{fmt(n)}</td>
                    <td className="num muted">{i === 0 ? '' : pct(n, funnel[i - 1][1])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="usage-grid">
            {report.sections.map((s) => (
              <section key={s.id} className="usage-card">
                <h2>{s.title}</h2>
                <TopValues rows={rows(r[s.id])} error={errorOf(r[s.id])} />
              </section>
            ))}
          </div>

          <section className="usage-card">
            <h2>Every event</h2>
            <table className="usage-table">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col" className="num">
                    Times
                  </th>
                  <th scope="col" className="num">
                    Visitors
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows(r.events).map((e) => (
                  <tr key={String(e.event)}>
                    <td>{e.event}</td>
                    <td className="num">{fmt(Number(e.n))}</td>
                    <td className="num">{fmt(Number(e.visitors))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {errorOf(r.events) && <p className="error">{errorOf(r.events)}</p>}
          </section>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, note, tip }: { label: string; value: string; note: string; tip?: string }) {
  return (
    <div className="usage-tile">
      <span className="muted field-label">
        {label}
        {tip && <InfoTip about={label.toLowerCase()}>{tip}</InfoTip>}
      </span>
      <strong>{value}</strong>
      <span className="muted">{note}</span>
    </div>
  );
}

/** One bar per day, every day of the period shown (empty days as gaps), with each day's value on hover. */
function DailyBars({ rows: data, days, unit, error }: { rows: Row[]; days: number; unit: string; error: string | null }) {
  if (error) return <p className="error">{error}</p>;
  const byDay = new Map(data.map((d) => [String(d.day).slice(0, 10), Number(d.n) || 0]));
  const today = new Date();
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)));
    const key = d.toISOString().slice(0, 10);
    return { key, n: byDay.get(key) ?? 0 };
  });
  const max = Math.max(1, ...series.map((s) => s.n));
  const total = series.reduce((sum, s) => sum + s.n, 0);
  const W = 100 / days;
  return (
    <figure className="usage-daily">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${fmt(total)} ${unit} over ${days} days`}>
        <line x1="0" y1="40" x2="100" y2="40" className="usage-axis" />
        {series.map((s, i) => {
          const h = (s.n / max) * 38;
          return (
            <g key={s.key}>
              {/* A hit area the full height of the day, bigger than the bar. */}
              <rect x={i * W} y="0" width={W} height="40" className="usage-hit">
                <title>{`${s.key}: ${fmt(s.n)} ${unit}`}</title>
              </rect>
              {s.n > 0 && <rect x={i * W + W * 0.15} y={40 - h} width={W * 0.7} height={h} className="usage-col" />}
            </g>
          );
        })}
      </svg>
      <figcaption className="muted">
        <span>{series[0].key}</span>
        <span>
          Peak {fmt(max === 1 && total === 0 ? 0 : max)} · total {fmt(total)}
        </span>
        <span>{series.at(-1)!.key}</span>
      </figcaption>
    </figure>
  );
}

/** The most common values of one field, as bars against the largest. */
function TopValues({ rows: data, error }: { rows: Row[]; error: string | null }) {
  if (error) return <p className="error">{error}</p>;
  if (!data.length) return <p className="muted">Nothing yet.</p>;
  const max = Math.max(1, ...data.map((d) => Number(d.n) || 0));
  return (
    <table className="usage-table">
      <tbody>
        {data.map((d, i) => {
          const n = Number(d.n) || 0;
          return (
            <tr key={i}>
              <th scope="row" className="usage-value">
                {d.value === '' || d.value === null ? <span className="muted">(none)</span> : String(d.value)}
              </th>
              <td className="usage-bar-cell">
                <span className="usage-bar" style={{ width: `${(n / max) * 100}%` }} title={fmt(n)} />
              </td>
              <td className="num">{fmt(n)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
