CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  internal_account_key TEXT NOT NULL UNIQUE,
  hubspot_account_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_hubspot_account_id
  ON clients (hubspot_account_id);

CREATE TABLE IF NOT EXISTS audits (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  score INTEGER NOT NULL,
  waste_estimate INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audits_client_created_at
  ON audits (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_results (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER NOT NULL UNIQUE REFERENCES audits(id) ON DELETE CASCADE,
  snapshot_json JSONB NOT NULL,
  rules_json JSONB NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
