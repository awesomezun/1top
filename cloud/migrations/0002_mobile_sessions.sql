CREATE TABLE IF NOT EXISTS mobile_sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 platform TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_user ON mobile_sessions(user_id);
ALTER TABLE tickets ADD COLUMN mobile_hash TEXT;
