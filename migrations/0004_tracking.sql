-- Tracking from Chit Chats for shipped orders: when it was last checked, and when the parcel arrived.
ALTER TABLE orders ADD COLUMN tracking_checked_at TEXT;
ALTER TABLE orders ADD COLUMN delivered_at TEXT;
