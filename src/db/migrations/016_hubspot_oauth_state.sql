CREATE TABLE IF NOT EXISTS hubspot_oauth_states (
  state_id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hubspot_oauth_states_expires_at
  ON hubspot_oauth_states (expires_at);

