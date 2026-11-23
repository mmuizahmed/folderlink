ALTER TABLE devices ADD COLUMN os TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN arch TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN client_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN client_region TEXT NOT NULL DEFAULT '';

CREATE TABLE pair_attempts (
  bucket TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pair_attempts ON pair_attempts (bucket, created_at);
