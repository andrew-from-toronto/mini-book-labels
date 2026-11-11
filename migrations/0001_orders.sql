-- Paid orders for blank books, written by the Stripe webhook (worker/webhook.ts).
CREATE TABLE orders (
  session_id TEXT PRIMARY KEY,          -- Stripe Checkout Session id
  order_code TEXT NOT NULL,             -- the book: size and options (src/lib/orderCode.ts)
  quantity INTEGER NOT NULL,
  amount_total INTEGER NOT NULL,        -- cents, including packing and shipping
  currency TEXT NOT NULL,
  email TEXT,
  name TEXT,
  shipping_address TEXT,                -- JSON, as Stripe collected it
  payment_status TEXT NOT NULL,         -- Stripe's: paid, unpaid, no_payment_required
  status TEXT NOT NULL,                 -- ours: paid, failed, shipped
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX orders_by_status ON orders (status, created_at);
