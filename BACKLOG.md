# Backlog

Ideas to do later, not started.

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

1. ~~**Orders database.**~~ Done: `mini-book-orders` exists with every migration applied. Deploys apply
   new ones, so the GitHub `CLOUDFLARE_API_TOKEN` needs the D1 Edit permission.
2. ~~**Stripe live.**~~ Done: live keys, webhook, and live paid orders tested.
3. ~~**Chit Chats live.**~~ Done: key and client id set, no `CHITCHATS_BASE_URL`.
4. ~~**Cloudflare Access.**~~ Done: `/admin*` and `/api/admin*` redirect to the Access login.
5. ~~**Worker secrets.**~~ Done. `SHIP_FROM_STREET_2` is not set, which is fine with no second address line.
6. ~~**Open the shop.**~~ Done: `SHOP_OPEN = true` on `main` (c1bacf4).
7. ~~**First order.**~~ Done: live paid orders tested end to end.
