-- Links from admin to the payment in Stripe, and cancelling an order with a full refund.
ALTER TABLE orders ADD COLUMN payment_intent TEXT;   -- Stripe PaymentIntent id
ALTER TABLE orders ADD COLUMN livemode INTEGER;      -- 1 for a live payment, 0 for test
ALTER TABLE orders ADD COLUMN refund_id TEXT;        -- Stripe Refund id, once refunded
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
