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

- Order and shipping emails to the buyer and to us (Resend was suggested).
- Admin page behind Cloudflare Access: orders, buying labels with Chit Chats, tracking, marking shipped.
- Real packing and labour costs in `src/lib/pricing.ts`, and real parcel sizes in `parcelFor`.
- US duty still shows on Chit Chats quotes after the CUSMA approval. Check whether shipments need a CUSMA
  flag, or ask Chit Chats.
- Go-live: remote D1 database, a restricted live Stripe key, the webhook endpoint, Worker secrets,
  Cloudflare Access, `SHOP_OPEN = true`.
- Test-print the 3 mm hook hole.
