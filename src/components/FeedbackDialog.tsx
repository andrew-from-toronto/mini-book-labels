import { useEffect, useRef, useState } from 'react';
import { InfoTip } from './InfoTip';
import { pageName, track } from '../lib/telemetry';
import { BUILD_ID } from '../lib/updates';

const MAX = 2000;

/** Feedback: a message, and an email if the sender wants a reply. Sent to worker/feedback.ts. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  // Never shown: people leave it empty, form-filling bots do not.
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          email,
          website,
          page: pageName(),
          build: BUILD_ID,
          coarse: matchMedia('(pointer: coarse)').matches,
          vw: innerWidth,
          vh: innerHeight,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'It did not send. Try again in a moment.');
      track('feedback', { withEmail: email.trim() !== '', length: message.trim().length });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="coffee-dialog feedback-dialog" onClose={onClose} aria-labelledby="feedback-title">
      <header>
        <h2 id="feedback-title">Feedback</h2>
        <button type="button" className="close" onClick={() => dialog.current?.close()} aria-label="Close">
          ×
        </button>
      </header>
      {sent ? (
        <div className="coffee-thanks">
          <p>Thanks, it's sent.</p>
          <button type="button" className="primary" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      ) : (
        <form
          className="coffee-choose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label>
            Message
            <textarea rows={6} maxLength={MAX} value={message} onChange={(e) => setMessage(e.target.value)} required autoFocus />
          </label>
          <div className="field">
            <span className="field-label">
              <label htmlFor="feedback-email">Email (optional)</label>
              <InfoTip about="email">Only if you'd like a reply. It's used for nothing else.</InfoTip>
            </span>
            <input id="feedback-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <label className="feedback-website" aria-hidden="true">
            Website
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="primary" disabled={busy || message.trim().length < 3}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </dialog>
  );
}
