-- The campaign link (utm_* parameters) that brought the buyer, as JSON (src/lib/attribution.ts).
ALTER TABLE orders ADD COLUMN source TEXT;
