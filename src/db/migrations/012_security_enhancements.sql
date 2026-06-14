ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS two_factor_secret_enc TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_verified_at TIMESTAMPTZ;

UPDATE users
SET role = COALESCE(NULLIF(role, ''), 'admin');

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'admin';

CREATE INDEX IF NOT EXISTS idx_users_role
  ON users (role);

CREATE TABLE IF NOT EXISTS security_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_tenant_created_at
  ON security_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_user_created_at
  ON security_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created_at
  ON security_events (event_type, created_at DESC);
