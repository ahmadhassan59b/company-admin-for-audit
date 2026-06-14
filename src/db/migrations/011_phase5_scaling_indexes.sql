CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_tenant_updated_at
  ON hubspot_accounts (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_audits_tenant_hubspot_account_created_at
  ON audits (tenant_id, hubspot_account_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audits_hubspot_portal_created_at
  ON audits (hubspot_portal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_cache_expires_at
  ON audit_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_cache_created_at
  ON audit_cache (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_costs_created_at
  ON audit_costs (created_at DESC);
