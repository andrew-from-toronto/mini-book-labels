/**
 * Order emails, sent with Mailgun's HTTP API (https://documentation.mailgun.com/docs/mailgun/api-reference/).
 * The buyer gets a confirmation and the shop gets a notice when Stripe reports an order paid.
 */
import { formatCad } from '../src/lib/pricing';

/** Mailgun settings: .dev.vars locally, Worker secrets in production. */
export interface MailEnv {
  MAILGUN_API_KEY?: string;
  /** The sending domain set up in Mailgun, e.g. minibookornaments.com. */
  MAILGUN_DOMAIN?: string;
  /** https://api.eu.mailgun.net for an EU account; the US API otherwise. */
  MAILGUN_BASE_URL?: string;
  /** Who emails come from, on MAILGUN_DOMAIN, e.g. "Mini Book Ornaments <support@email.minibookornaments.com>". */
  MAIL_FROM?: string;
  /** Where buyers' replies go; the From address when not set. */
  MAIL_REPLY_TO?: string;
  /** Where new-order notices go. */
  ORDER_NOTIFY_TO?: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

/** What is missing for sending, or null when ready. */
export function mailMissing(env: MailEnv): string[] | null {
  const missing = (['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAIL_FROM', 'ORDER_NOTIFY_TO'] as const).filter((k) => !env[k]?.trim());
  return missing.length ? missing : null;
}

export class MailError extends Error {}

export async function sendMail(env: MailEnv, mail: Mail, fetcher: typeof fetch = fetch): Promise<void> {
  const base = (env.MAILGUN_BASE_URL?.trim() || 'https://api.mailgun.net').replace(/\/$/, '');
  const form = new URLSearchParams({
    from: env.MAIL_FROM!,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    // No open or click tracking: no pixels or rewritten links in order emails.
    'o:tracking': 'no',
  });
  if (mail.replyTo) form.set('h:Reply-To', mail.replyTo);
  const res = await fetcher(`${base}/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
    body: form,
  });
  if (!res.ok) throw new MailError(`Mailgun ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/** An order as the emails describe it. Amounts in cents, CAD. */
export interface OrderDetails {
  /** The Stripe Checkout Session id: the order's id in admin. */
  sessionId: string;
  code: string;
  quantity: number;
  /** "30 x 20 x 5 mm, black, flat spine, hook centred, front" */
  description: string;
  name: string;
  email: string;
  /** The shipping address, one line each. */
  address: string[];
  /** Blanks and packing. */
  subtotal: number;
  shipping: number;
  total: number;
  /** "Standard", "Express"; what the buyer chose. */
  delivery: string | null;
  /** The shipping vendor and its service, to buy the label with. */
  provider: string | null;
  service: string | null;
  paymentIntent: string | null;
  livemode: boolean;
  site: string;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const blanks = (n: number) => (n === 1 ? '1 blank mini book' : `${n} blank mini books`);

/** Rows of label and value, as text lines and as an HTML table. */
function rows(lines: [string, string][]) {
  return {
    text: lines.map(([k, v]) => `${k}: ${v}`).join('\n'),
    html: `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:480px">${lines
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#6f685e">${escape(k)}</td><td style="padding:4px 0;text-align:right">${escape(v)}</td></tr>`,
      )
      .join('')}</table>`,
  };
}

const page = (body: string) =>
  `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ec;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#23201c;font-size:15px;line-height:1.5"><div style="max-width:520px;margin:0 auto;background:#fffdf9;border:1px solid #ddd6ca;border-radius:10px;padding:24px">${body}</div></body></html>`;

/** The buyer's confirmation. */
export function buyerEmail(o: OrderDetails, replyTo?: string): Mail {
  const first = o.name.split(/\s+/)[0] || 'there';
  const money = rows([
    ['Blanks and packing', formatCad(o.subtotal)],
    [o.delivery ? `Shipping (${o.delivery})` : 'Shipping', formatCad(o.shipping)],
    ['Total', formatCad(o.total)],
  ]);
  const text = [
    `Hi ${first},`,
    '',
    "Thanks for your order. We'll email you when it ships.",
    '',
    `${blanks(o.quantity)}`,
    o.description,
    '',
    money.text,
    '',
    'Shipping to',
    ...o.address,
    '',
    'Questions? Reply to this email.',
    '',
    'Mini Book Ornaments',
    o.site,
  ].join('\n');
  const html = page(
    `<p>Hi ${escape(first)},</p>
<p>Thanks for your order. We'll email you when it ships.</p>
<h2 style="font-size:16px;margin:20px 0 4px">${escape(blanks(o.quantity))}</h2>
<p style="margin:0 0 12px;color:#6f685e">${escape(o.description)}</p>
${money.html}
<h2 style="font-size:16px;margin:20px 0 4px">Shipping to</h2>
<p style="margin:0">${o.address.map(escape).join('<br>')}</p>
<p style="margin-top:20px">Questions? Reply to this email.</p>
<p style="margin:0;color:#6f685e">Mini Book Ornaments<br><a href="${escape(o.site)}" style="color:#8a4b2a">${escape(o.site.replace(/^https?:\/\//, ''))}</a></p>`,
  );
  return { to: o.email, subject: `Order confirmed: ${blanks(o.quantity)}`, text, html, replyTo };
}

/** The shop's notice: what to print, where to send it, and links to the model and the payment. */
export function sellerEmail(o: OrderDetails, to: string): Mail {
  const model = `${o.site}/#order=${encodeURIComponent(o.code)}`;
  const download = `${o.site}/model/?code=${encodeURIComponent(o.code)}`;
  const admin = `${o.site}/admin/?order=${encodeURIComponent(o.sessionId)}`;
  const payment = o.paymentIntent
    ? `https://dashboard.stripe.com/${o.livemode ? '' : 'test/'}payments/${o.paymentIntent}`
    : null;
  const details = rows([
    ['Quantity', String(o.quantity)],
    ['Book', o.description],
    ['Code', o.code],
    ['Delivery', [o.delivery, o.provider, o.service].filter(Boolean).join(' · ') || 'unknown'],
    ['Total', formatCad(o.total)],
    ['Buyer', `${o.name} <${o.email}>`],
  ]);
  const text = [
    details.text,
    '',
    'Ship to',
    ...o.address,
    '',
    `Open in admin: ${admin}`,
    `Download the model: ${download}`,
    `Open in the designer: ${model}`,
    ...(payment ? [`Payment: ${payment}`] : []),
  ].join('\n');
  const html = page(
    `${details.html}
<h2 style="font-size:16px;margin:20px 0 4px">Ship to</h2>
<p style="margin:0">${o.address.map(escape).join('<br>')}</p>
<p style="margin-top:20px"><a href="${escape(admin)}" style="display:inline-block;padding:10px 16px;background:#8a4b2a;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Open in admin</a></p>
<p><a href="${escape(download)}" style="color:#8a4b2a">Download the model</a> · <a href="${escape(model)}" style="color:#8a4b2a">Open in the designer</a>${
      payment ? ` · <a href="${escape(payment)}" style="color:#8a4b2a">Payment in Stripe</a>` : ''
    }</p>`,
  );
  return {
    to,
    subject: `${o.livemode ? '' : '[Test] '}New order: ${o.quantity} × ${o.description}`,
    text,
    html,
    replyTo: o.email,
  };
}

export interface ShippedDetails {
  name: string;
  email: string;
  quantity: number;
  description: string;
  trackingUrl: string | null;
  trackingCode: string | null;
  site: string;
}

/** The buyer's shipping notice, with tracking. */
export function shippedEmail(o: ShippedDetails, replyTo?: string): Mail {
  const first = o.name.split(/\s+/)[0] || 'there';
  const tracking = o.trackingUrl ?? null;
  const text = [
    `Hi ${first},`,
    '',
    'Your order has shipped.',
    '',
    blanks(o.quantity),
    o.description,
    '',
    ...(tracking ? [`Track it: ${tracking}`] : []),
    ...(o.trackingCode ? [`Tracking number: ${o.trackingCode}`] : []),
    '',
    'Questions? Reply to this email.',
    '',
    'Mini Book Ornaments',
    o.site,
  ].join('\n');
  const html = page(
    `<p>Hi ${escape(first)},</p>
<p>Your order has shipped.</p>
<h2 style="font-size:16px;margin:20px 0 4px">${escape(blanks(o.quantity))}</h2>
<p style="margin:0 0 12px;color:#6f685e">${escape(o.description)}</p>
${tracking ? `<p><a href="${escape(tracking)}" style="display:inline-block;padding:10px 16px;background:#8a4b2a;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Track your order</a></p>` : ''}
${o.trackingCode ? `<p style="color:#6f685e">Tracking number: ${escape(o.trackingCode)}</p>` : ''}
<p style="margin-top:20px">Questions? Reply to this email.</p>
<p style="margin:0;color:#6f685e">Mini Book Ornaments<br><a href="${escape(o.site)}" style="color:#8a4b2a">${escape(o.site.replace(/^https?:\/\//, ''))}</a></p>`,
  );
  return { to: o.email, subject: 'Your order has shipped', text, html, replyTo };
}

export interface CancelledDetails {
  name: string;
  email: string;
  quantity: number;
  description: string;
  /** Cents, CAD. */
  refunded: number;
  site: string;
}

/** The buyer's notice that their order was cancelled and refunded. */
export function cancelledEmail(o: CancelledDetails, replyTo?: string): Mail {
  const first = o.name.split(/\s+/)[0] || 'there';
  const text = [
    `Hi ${first},`,
    '',
    `Your order has been cancelled and ${formatCad(o.refunded)} refunded to your card. It can take 5 to 10 days to appear.`,
    '',
    blanks(o.quantity),
    o.description,
    '',
    'Questions? Reply to this email.',
    '',
    'Mini Book Ornaments',
    o.site,
  ].join('\n');
  const html = page(
    `<p>Hi ${escape(first)},</p>
<p>Your order has been cancelled and <strong>${escape(formatCad(o.refunded))}</strong> refunded to your card. It can take 5 to 10 days to appear.</p>
<h2 style="font-size:16px;margin:20px 0 4px">${escape(blanks(o.quantity))}</h2>
<p style="margin:0 0 12px;color:#6f685e">${escape(o.description)}</p>
<p style="margin-top:20px">Questions? Reply to this email.</p>
<p style="margin:0;color:#6f685e">Mini Book Ornaments<br><a href="${escape(o.site)}" style="color:#8a4b2a">${escape(o.site.replace(/^https?:\/\//, ''))}</a></p>`,
  );
  return { to: o.email, subject: 'Your order has been cancelled', text, html, replyTo };
}
