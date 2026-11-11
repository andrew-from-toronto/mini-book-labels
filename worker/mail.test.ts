import { describe, expect, it, vi } from 'vitest';
import { buyerEmail, mailMissing, sellerEmail, sendMail, type MailEnv, type OrderDetails } from './mail';
import { emailOrder } from './orderEmails';

const env: MailEnv = {
  MAILGUN_API_KEY: 'key-test',
  MAILGUN_DOMAIN: 'minibookornaments.com',
  MAIL_FROM: 'Mini Book Ornaments <orders@minibookornaments.com>',
  ORDER_NOTIFY_TO: 'shop@minibookornaments.com',
};

const order: OrderDetails = {
  code: 'v1-h300-w200-s50-flat-nohook-c-black',
  quantity: 2,
  description: '30 x 20 x 5 mm, black, flat spine, no hook',
  name: 'Ada <b>Lovelace</b>',
  email: 'ada@example.com',
  address: ['Ada <b>Lovelace</b>', '290 Bremner Blvd', 'Toronto ON M5V 3L9', 'Canada'],
  subtotal: 1200,
  shipping: 448,
  total: 1648,
  delivery: 'Standard',
  service: 'chit_chats_canada_tracked',
  paymentIntent: 'pi_123',
  livemode: false,
  site: 'https://minibookornaments.com',
};

describe('order emails', () => {
  it('confirm the order to the buyer, escaping what they typed', () => {
    const mail = buyerEmail(order, 'hello@minibookornaments.com');
    expect(mail.to).toBe('ada@example.com');
    expect(mail.subject).toBe('Order confirmed: 2 blank mini books');
    expect(mail.text).toContain('Shipping (Standard): $4.48');
    expect(mail.text).toContain('Total: $16.48');
    expect(mail.html).toContain('Ada,');
    expect(mail.html).not.toContain('<b>Lovelace');
    expect(mail.html).toContain('&lt;b&gt;Lovelace');
    expect(mail.replyTo).toBe('hello@minibookornaments.com');
  });

  it('tell the shop what to print, with links to the model and the test payment', () => {
    const mail = sellerEmail(order, 'shop@minibookornaments.com');
    expect(mail.subject).toBe('[Test] New order: 2 × 30 x 20 x 5 mm, black, flat spine, no hook');
    expect(mail.text).toContain('https://minibookornaments.com/model/?code=v1-h300-w200-s50-flat-nohook-c-black');
    expect(mail.text).toContain('https://minibookornaments.com/#order=v1-h300-w200-s50-flat-nohook-c-black');
    expect(mail.text).toContain('https://dashboard.stripe.com/test/payments/pi_123');
    expect(mail.text).toContain('Delivery: Standard · chit_chats_canada_tracked');
    expect(mail.replyTo).toBe('ada@example.com');
  });

  it('name the settings that are missing', () => {
    expect(mailMissing(env)).toBeNull();
    expect(mailMissing({ ...env, MAILGUN_API_KEY: ' ' })).toEqual(['MAILGUN_API_KEY']);
  });

  it('post to Mailgun with basic auth and no tracking', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    await sendMail({ ...env, MAILGUN_BASE_URL: 'https://api.eu.mailgun.net/' }, buyerEmail(order), fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.eu.mailgun.net/v3/minibookornaments.com/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('api:key-test')}`);
    const body = init.body as URLSearchParams;
    expect(body.get('to')).toBe('ada@example.com');
    expect(body.get('o:tracking')).toBe('no');
    await expect(sendMail(env, buyerEmail(order), async () => new Response('nope', { status: 401 }))).rejects.toThrow(/401/);
  });
});

/** Just enough of D1 for emailOrder: one row and its two email columns. */
function fakeDb(row: { buyer_emailed_at: string | null; seller_emailed_at: string | null } | null) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => (row ? { ...row } : null),
        run: async () => {
          const column = sql.match(/SET (\w+) =/)?.[1] as keyof NonNullable<typeof row>;
          if (row) row[column] = 'now';
        },
      }),
    }),
    row,
  };
}

describe('emailOrder', () => {
  it('sends each email once, and after a failure only what has not gone', async () => {
    const db = fakeDb({ buyer_emailed_at: null, seller_emailed_at: null });
    let fail = true;
    const send = vi.fn(async (_env: MailEnv, mail: { to: string }) => {
      if (mail.to === env.ORDER_NOTIFY_TO && fail) throw new Error('Mailgun down');
    });
    await expect(emailOrder(db as unknown as D1Database, env, 'cs_1', order, send)).rejects.toThrow('Mailgun down');
    expect(db.row).toEqual({ buyer_emailed_at: 'now', seller_emailed_at: null });
    fail = false;
    await emailOrder(db as unknown as D1Database, env, 'cs_1', order, send);
    await emailOrder(db as unknown as D1Database, env, 'cs_1', order, send);
    expect(send.mock.calls.map(([, m]) => m.to)).toEqual(['ada@example.com', env.ORDER_NOTIFY_TO, env.ORDER_NOTIFY_TO]);
  });

  it('sends nothing without Mailgun settings', async () => {
    const send = vi.fn();
    await emailOrder(fakeDb({ buyer_emailed_at: null, seller_emailed_at: null }) as unknown as D1Database, {}, 'cs_1', order, send);
    expect(send).not.toHaveBeenCalled();
  });
});
