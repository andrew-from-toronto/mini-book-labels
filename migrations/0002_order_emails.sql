-- When each order email went, so Stripe's retries never send one twice.
ALTER TABLE orders ADD COLUMN buyer_emailed_at TEXT;
ALTER TABLE orders ADD COLUMN seller_emailed_at TEXT;
