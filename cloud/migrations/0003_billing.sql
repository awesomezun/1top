CREATE TABLE IF NOT EXISTS billing_customers (
 user_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL UNIQUE,
 subscription_id TEXT, status TEXT NOT NULL DEFAULT 'inactive',
 created_at INTEGER NOT NULL, updated_at INTEGER
);
