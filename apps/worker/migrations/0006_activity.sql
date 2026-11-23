-- Audit log for tool calls. Only metadata is stored: who, which device and
-- app, which operation, folder label and path, and whether it worked. File
-- contents are never stored. Rows older than 30 days are pruned lazily when
-- the log is read.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  client TEXT NOT NULL DEFAULT 'mcp',
  op TEXT NOT NULL,
  folder TEXT,
  path TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_activity_user_created ON activity (user_id, created_at DESC);
