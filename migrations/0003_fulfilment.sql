-- Fulfilment from admin: the delivery the buyer chose, the Chit Chats shipment and label, and shipping.
ALTER TABLE orders ADD COLUMN delivery TEXT;              -- "Standard", "Express": what the buyer chose
ALTER TABLE orders ADD COLUMN shipping_service TEXT;      -- the Chit Chats postage_type quoted at checkout
ALTER TABLE orders ADD COLUMN shipping_amount INTEGER;    -- cents the buyer paid for shipping
ALTER TABLE orders ADD COLUMN chitchats_shipment_id TEXT;
ALTER TABLE orders ADD COLUMN label_status TEXT;          -- Chit Chats shipment status: unpaid, ready, voided...
ALTER TABLE orders ADD COLUMN postage_type TEXT;          -- the service the label was bought with
ALTER TABLE orders ADD COLUMN postage_cost TEXT;          -- what the label cost, CAD, as Chit Chats gives it
ALTER TABLE orders ADD COLUMN tracking_code TEXT;
ALTER TABLE orders ADD COLUMN tracking_url TEXT;
ALTER TABLE orders ADD COLUMN label_pdf_url TEXT;
ALTER TABLE orders ADD COLUMN label_png_url TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN shipped_emailed_at TEXT;
