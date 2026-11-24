-- Dashboard approval requests for write/delete/exec. The bridge is the
-- authority: it mints and verifies the single-use token, and it holds
-- the content hashes the approval binds to. This table is transport and
-- record-keeping only — the dashboard reads it to show pending requests,
-- and the worker marks rows decided when the second tool call lands.
-- File contents are never stored here, only hashes and the diff/preview
-- the bridge computed. A row whose bridge-side request is gone (the
-- bridge restarted) fails closed: approving it returns 410.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  grant_id TEXT,
  client TEXT NOT NULL DEFAULT 'unknown',
  tool TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  folder_label TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  op TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  pre_hash TEXT NOT NULL DEFAULT '',
  diff TEXT NOT NULL DEFAULT '',
  preview TEXT NOT NULL DEFAULT '',
  argv TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT -1,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT
);

CREATE INDEX idx_approvals_user_status_created ON approvals (user_id, status, created_at);
