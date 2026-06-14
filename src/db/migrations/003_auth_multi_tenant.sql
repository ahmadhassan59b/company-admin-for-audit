CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id
  ON users (tenant_id);

CREATE TABLE IF NOT EXISTS hubspot_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  hubspot_account_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hubspot_account_id)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_tenant_id
  ON hubspot_accounts (tenant_id);

CREATE TABLE IF NOT EXISTS migration_client_keys (
  client_key TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_clients_tenant_id
  ON clients (tenant_id);

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS hubspot_account_uuid UUID REFERENCES hubspot_accounts(id);

CREATE INDEX IF NOT EXISTS idx_audits_tenant_created_at
  ON audits (tenant_id, created_at DESC);
