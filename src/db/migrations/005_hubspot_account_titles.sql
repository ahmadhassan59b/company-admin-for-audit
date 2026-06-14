ALTER TABLE hubspot_accounts
  ADD COLUMN IF NOT EXISTS hubspot_account_name TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_account_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_name
  ON hubspot_accounts (hubspot_account_name);

