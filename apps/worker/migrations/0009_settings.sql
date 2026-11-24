-- Per-user settings, keyed by (user, name). The write approval mode
-- lives here: key 'write_approval_mode', value 'ai' or 'manual'. No row
-- means the default, 'ai'. The worker is the source of truth; the bridge
-- keeps a local cache synced over the websocket and fails closed to
-- manual when it has neither a sync nor a cache.
CREATE TABLE settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
