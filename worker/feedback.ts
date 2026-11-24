/**
 * POST /api/feedback: a message from the app's Feedback form (src/components/FeedbackDialog.tsx), saved to
 * the feedback table (migrations/0009_feedback.sql) and emailed to the shop. Only from this site's pages;
 * a hidden field that people never fill in turns away most bots.
 */
import { json } from './cache';
import { fromOwnSite } from './imageProxy';
import { mailMissing, sendMail, type Mail, type MailEnv } from './mail';
import { browserOf, deviceOf } from './telemetry';

export const MAX_MESSAGE = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FeedbackRow {
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

export type Feedback = Omit<FeedbackRow, 'id' | 'created_at' | 'status'>;

/** The form's fields checked and cut to size; or what is wrong with them. */
export function readFeedback(body: unknown, ua: string, country: string | null): Feedback | { error: string } | 'bot' {
  if (!body || typeof body !== 'object') return { error: 'Write a message first.' };
  const b = body as Record<string, unknown>;
  if (typeof b.website === 'string' && b.website.trim()) return 'bot';
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (message.length < 3) return { error: 'Write a message first.' };
  if (message.length > MAX_MESSAGE) return { error: `Keep it under ${MAX_MESSAGE} characters.` };
  const email = typeof b.email === 'string' ? b.email.trim().slice(0, 200) : '';
  if (email && !EMAIL.test(email)) return { error: 'That email address does not look right.' };
  const short = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  return {
    message,
    email: email || null,
    page: short(b.page, 40),
    device: deviceOf({ coarse: b.coarse === true, vw: Number(b.vw) || 0, vh: Number(b.vh) || 0 }),
    browser: browserOf(ua),
    build: short(b.build, 80),
    country,
  };
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The shop's copy of a message. Replying answers the sender, when they gave an email. */
export function feedbackEmail(f: Feedback, to: string, adminUrl: string): Mail {
  const about = [f.page && `on ${f.page}`, f.device, f.browser, f.country].filter(Boolean).join(', ');
  const text = `${f.message}\n\n${f.email ? `From ${f.email}` : 'No email given'} (${about})\n${adminUrl}\n`;
  const html = `<p style="white-space:pre-wrap">${escape(f.message)}</p><p style="color:#6f685e">${
    f.email ? `From ${escape(f.email)}` : 'No email given'
  } (${escape(about)})<br><a href="${escape(adminUrl)}">All feedback</a></p>`;
  return { to, subject: `Feedback: ${f.message.replace(/\s+/g, ' ').slice(0, 60)}`, text, html, replyTo: f.email ?? undefined };
}

export async function handleFeedback(
  request: Request,
  env: MailEnv & { ORDERS: D1Database },
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (!fromOwnSite(request)) return json(403, { error: 'Feedback is sent from this site.' });
  let body: unknown;
  try {
    body = JSON.parse((await request.text()).slice(0, 10_000));
  } catch {
    return json(400, { error: 'Write a message first.' });
  }
  const ua = request.headers.get('user-agent') ?? '';
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  const f = readFeedback(body, ua, country);
  // A bot is told it worked, so it has nothing to learn from.
  if (f === 'bot') return json(200, { ok: true });
  if ('error' in f) return json(400, f);
  await env.ORDERS.prepare(
    'INSERT INTO feedback (message, email, page, device, browser, build, country) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
  )
    .bind(f.message, f.email, f.page, f.device, f.browser, f.build, f.country)
    .run();
  if (!mailMissing(env)) {
    const adminUrl = `${new URL(request.url).origin}/admin/?view=feedback`;
    waitUntil(sendMail(env, feedbackEmail(f, env.ORDER_NOTIFY_TO!, adminUrl)).catch((e) => console.error('feedback email failed', e)));
  }
  return json(200, { ok: true });
}

export const allFeedback = async (db: D1Database) =>
  (await db.prepare('SELECT * FROM feedback ORDER BY created_at DESC, id DESC LIMIT 500').all<FeedbackRow>()).results;

export async function setFeedbackStatus(db: D1Database, id: number, status: 'new' | 'done') {
  await db.prepare('UPDATE feedback SET status = ?2 WHERE id = ?1').bind(id, status).run();
}
