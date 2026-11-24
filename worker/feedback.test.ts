import { describe, expect, it, vi } from 'vitest';
import { feedbackEmail, handleFeedback, readFeedback } from './feedback';

const UA = 'Mozilla/5.0 (iPhone) AppleWebKit/605 Version/27 Mobile Safari/605';

describe('feedback', () => {
  it('keeps the message and an email given for a reply, with the device worked out', () => {
    expect(readFeedback({ message: '  Love it! ', email: 'a@b.co', page: 'app', coarse: true, vw: 390, vh: 844 }, UA, 'CA')).toEqual({
      message: 'Love it!',
      email: 'a@b.co',
      page: 'app',
      device: 'phone',
      browser: 'Safari',
      build: null,
      country: 'CA',
    });
  });

  it('turns away empty or long messages, bad emails, and bots', () => {
    expect(readFeedback({ message: ' ' }, UA, null)).toEqual({ error: 'Write a message first.' });
    expect(readFeedback({ message: 'x'.repeat(2001) }, UA, null)).toMatchObject({ error: expect.stringContaining('2000') });
    expect(readFeedback({ message: 'Hello', email: 'not an email' }, UA, null)).toMatchObject({ error: expect.stringContaining('email') });
    expect(readFeedback({ message: 'Buy now', website: 'https://spam.example' }, UA, null)).toBe('bot');
  });

  it('emails the shop with the sender as reply-to, escaping the message', () => {
    const mail = feedbackEmail(
      { message: '<b>hi</b>', email: 'a@b.co', page: 'app', device: 'phone', browser: 'Safari', build: null, country: 'CA' },
      'shop@example.com',
      'https://x/admin/?view=feedback',
    );
    expect(mail).toMatchObject({ to: 'shop@example.com', replyTo: 'a@b.co', subject: 'Feedback: <b>hi</b>' });
    expect(mail.html).toContain('&#60;b&#62;hi');
    expect(mail.html).not.toContain('<b>hi');
  });

  it('saves a message sent from this site and refuses one from elsewhere', async () => {
    const run = vi.fn(async () => ({}));
    const bind = vi.fn(() => ({ run }));
    const env = { ORDERS: { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database };
    const post = (site: string) =>
      handleFeedback(
        new Request('https://x/api/feedback', { method: 'POST', body: JSON.stringify({ message: 'Hello there' }), headers: { 'Sec-Fetch-Site': site } }),
        env,
        () => {},
      );
    expect((await post('same-origin')).status).toBe(200);
    expect(bind).toHaveBeenCalledWith('Hello there', null, null, 'desktop', 'Other', null, null);
    expect((await post('cross-site')).status).toBe(403);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
