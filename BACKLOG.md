# Backlog

Ideas to do later, not started.

## After printing: offer blanks or a coffee

Once someone prints a label sheet, show a small prompt with two choices:

- **Order blanks**: opens the order page for the book they designed (`orderUrl` in `src/lib/shop.ts`).
- **Buy me a coffee**: a tip.

Notes:

- Show it after printing (the browser's `afterprint` event), not before, and at most once per visit. Make it easy to dismiss.
- Only offer blanks while the shop is open (`shopVisible()`), and only for printable sizes (`printable()`).
- Move "buy me a coffee" to Stripe, off buymeacoffee.com. It's linked in `src/App.tsx` and `README.md`. A Stripe
  Payment Link with "customer chooses price" is likely the simplest; a tips product in the existing
  checkout would also work.

## Also waiting

- Real packing and labour costs in `src/lib/pricing.ts`, and the real packed parcel (size, weight) in
  `parcelFor` (`worker/shipping/parcel.ts`).
- US tariff: Chit Chats still adds a US tariff fee (50% of value) to US quotes. We send the HS code,
  origin and description exactly as on the CUSMA certificate; with or without dots in the HS code makes
  no difference. Ask Chit Chats whether API shipments use the certificate on file.
- ShipStation API as a second vendor: built (`worker/shipping/shipstation.ts`), waiting on the account
  activating (card payment fails with a 500 from their processor). Then set `SHIPSTATION_API_KEY` and
  `SHIP_FROM_PHONE`, and check rates and a label in its sandbox.
- Hold payments until shipped (Stripe manual capture): a card hold lasts about 4.5 days on Visa, so
  only if print-and-ship is reliably faster.
- Test-print the 3 mm hook hole.

## Go-live

In order. Nothing here is automatic; each step is done once.

1. **Orders database.** `pnpm exec wrangler d1 create mini-book-orders`, then put the id it prints in
   `wrangler.jsonc` (`database_id`, now all zeros). Deploys apply `migrations/` to it, so the GitHub
   `CLOUDFLARE_API_TOKEN` also needs the D1 Edit permission.
2. **Stripe live.** In live mode: a restricted key (`rk_live_`) with write access to Checkout Sessions
   and read access to Shipping Rates; the publishable key; a webhook endpoint at
   `https://minibookornaments.com/api/stripe/webhook` for `checkout.session.completed`,
   `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`, and its
   signing secret. Turn on receipt emails. Register `minibookornaments.com` under payment method domains
   for Apple Pay and Google Pay. Roll the sandbox secret key used in development.
3. **Chit Chats live.** The live account's key and client id; no `CHITCHATS_BASE_URL`.
4. **Cloudflare Access.** A self-hosted application covering `minibookornaments.com/admin*` and
   `minibookornaments.com/api/admin*`, allowing only you. Note its AUD tag and the team domain.
5. **Worker secrets** (`pnpm exec wrangler secret put NAME` for each):
   `STRIPE_API_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `CHITCHATS_API_KEY`, `CHITCHATS_CLIENT_ID`,
   `SHIP_FROM_NAME`, `SHIP_FROM_STREET`, `SHIP_FROM_STREET_2`, `SHIP_FROM_CITY`, `SHIP_FROM_PROVINCE`,
   `SHIP_FROM_POSTAL_CODE`, `SHIP_FROM_COUNTRY`,
   `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAIL_FROM`, `MAIL_REPLY_TO`, `ORDER_NOTIFY_TO`,
   `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.
6. **Open the shop.** `SHOP_OPEN = true` in `src/lib/shop.ts`, merge `checkout` into `main`, and the
   deploy goes out.
7. **First order.** Buy one blank with a real card, check both emails, buy its label in admin, and
   refund the payment in Stripe if it was only a test.
