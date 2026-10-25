CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
 platform TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL, revoked_at INTEGER, allow_control INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS pairings (
 code TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 platform TEXT NOT NULL, expires_at INTEGER NOT NULL, user_id TEXT,
 allow_control INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tickets (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, auth_expires INTEGER NOT NULL, mobile_hash TEXT
);
CREATE TABLE IF NOT EXISTS request_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mobile_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mobile_user ON mobile_sessions(user_id);
CREATE TABLE IF NOT EXISTS hosted_access (
 user_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('operator','subscription','trial')),
 expires_at INTEGER,
 max_devices INTEGER NOT NULL CHECK(max_devices BETWEEN 1 AND 25),
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 CHECK(kind='operator' OR expires_at IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS billing_customers (
 user_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE,
 subscription_id TEXT, status TEXT NOT NULL DEFAULT 'inactive',
 created_at INTEGER NOT NULL, updated_at INTEGER
);
