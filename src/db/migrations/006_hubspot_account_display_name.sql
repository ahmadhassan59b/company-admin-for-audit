ALTER TABLE hubspot_accounts
  ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_display_name
  ON hubspot_accounts (display_name);

