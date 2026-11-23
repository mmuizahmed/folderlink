-- Account state is active or suspended. Suspended accounts are refused.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  google_sub TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  paired_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_devices_user ON devices (user_id, status);

CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pairing_device ON pairing_codes (device_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_access_user ON access_tokens (user_id);

-- Rotating refresh tokens. Presenting a revoked token revokes the whole family.
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT
);

CREATE INDEX idx_refresh_family ON refresh_tokens (family_id);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  label TEXT NOT NULL,
  approval TEXT NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending', 'approved', 'revoked')),
  listed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_folders_device ON folders (device_id, listed);

CREATE TABLE login_states (
  state TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE mcp_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE auth_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
