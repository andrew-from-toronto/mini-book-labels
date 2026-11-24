-- Messages sent with the app's Feedback form (worker/feedback.ts). The email is there only if the sender
-- gave one for a reply; nothing ties a message to usage events.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  message TEXT NOT NULL,
  email TEXT,
  page TEXT,
  device TEXT,
  browser TEXT,
  build TEXT,
  country TEXT,
  -- new, or done once read and dealt with.
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX feedback_created ON feedback (created_at DESC);
