CREATE TABLE IF NOT EXISTS hosted_access (
 user_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('operator','subscription','trial')),
 expires_at INTEGER,
 max_devices INTEGER NOT NULL CHECK(max_devices BETWEEN 1 AND 25),
 created_at INTEGER NOT NULL,
 revoked_at INTEGER,
 CHECK(kind='operator' OR expires_at IS NOT NULL)
);
