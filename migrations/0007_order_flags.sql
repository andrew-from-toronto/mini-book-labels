-- Why a paid order needs checking before it's made: the price or shipping doesn't add up (worker/webhook.ts).
ALTER TABLE orders ADD COLUMN flag TEXT;
