import { useEffect, useState } from 'react';
import { api } from '../lib/adminApi';
import { AdminNav } from './AdminNav';

/** A feedback row as /api/admin/feedback gives it (worker/feedback.ts). */
interface Feedback {
  id: number;
  created_at: string;
  message: string;
  email: string | null;
  page: string | null;
  device: string | null;
  browser: string | null;
  build: string | null;
  country: string | null;
  status: string;
}

const when = (iso: string) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

/** Messages from the app's Feedback form, newest first; each marked done once dealt with. */
export function AdminFeedback() {
  const [list, setList] = useState<Feedback[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ feedback: Feedback[] }>('feedback')
      .then((d) => setList(d.feedback))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function mark(f: Feedback, status: 'new' | 'done') {
    try {
      setList((await api<{ feedback: Feedback[] }>(`feedback/${f.id}/status`, { status })).feedback);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const shown = list?.filter((f) => showDone || f.status !== 'done') ?? [];
  const done = list?.filter((f) => f.status === 'done').length ?? 0;

  return (
    <main className="admin-usage">
      <header className="admin-usage-head">
        <a href="/" className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          Mini Book Labels
        </a>
        <AdminNav current="feedback" />
        <label className="check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show done ({done})
        </label>
      </header>
      {error && <p className="error">{error}</p>}
      {!list && !error && <p className="muted">Loading…</p>}
      {list && shown.length === 0 && <p className="muted">No feedback{showDone ? '' : ' to read'}.</p>}
      <ul className="feedback-list">
        {shown.map((f) => (
          <li key={f.id} className={`usage-card${f.status === 'done' ? ' feedback-done' : ''}`}>
            <p className="feedback-message">{f.message}</p>
            <p className="muted feedback-meta">
              {when(f.created_at)}
              {f.email && (
                <>
                  {' · '}
                  <a href={`mailto:${f.email}?subject=${encodeURIComponent('Your Mini Book Labels feedback')}`}>{f.email}</a>
                </>
              )}
              {[f.page, f.device, f.browser, f.country].filter(Boolean).map((v) => ` · ${v}`)}
            </p>
            <button type="button" onClick={() => void mark(f, f.status === 'done' ? 'new' : 'done')}>
              {f.status === 'done' ? 'Mark as new' : 'Done'}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
