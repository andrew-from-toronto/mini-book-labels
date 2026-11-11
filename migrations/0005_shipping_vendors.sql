-- Shipping through more than one vendor: shipments and choices name their vendor, and label states are
-- the common ones (worker/shipping/types.ts) rather than Chit Chats' own.
ALTER TABLE orders RENAME COLUMN chitchats_shipment_id TO shipment_id;
ALTER TABLE orders ADD COLUMN shipment_provider TEXT;   -- the vendor the label is with
ALTER TABLE orders ADD COLUMN shipping_provider TEXT;   -- the vendor of the service the buyer chose
ALTER TABLE orders ADD COLUMN label_cost INTEGER;       -- cents, CAD

UPDATE orders SET shipment_provider = 'chitchats' WHERE shipment_id IS NOT NULL;
UPDATE orders SET shipping_provider = 'chitchats' WHERE shipping_service IS NOT NULL;
UPDATE orders SET label_cost = CAST(ROUND(CAST(postage_cost AS REAL) * 100) AS INTEGER) WHERE postage_cost IS NOT NULL;
UPDATE orders SET label_status = CASE label_status
  WHEN 'pending' THEN 'unpaid'
  WHEN 'postage_requested' THEN 'buying'
  WHEN 'postage_purchase_failed' THEN 'failed'
  WHEN 'ready' THEN 'label'
  WHEN 'received' THEN 'in_transit'
  WHEN 'released' THEN 'in_transit'
  WHEN 'inducted' THEN 'in_transit'
  WHEN 'resolved' THEN 'in_transit'
  WHEN 'canceled' THEN 'voided'
  ELSE label_status
END;
