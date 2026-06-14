ALTER TABLE hubspot_accounts
  ADD COLUMN IF NOT EXISTS account_name TEXT,
  ADD COLUMN IF NOT EXISTS account_domain TEXT,
  ADD COLUMN IF NOT EXISTS account_timezone TEXT,
  ADD COLUMN IF NOT EXISTS account_currency TEXT;

CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_account_name
  ON hubspot_accounts (account_name);

CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_account_domain
  ON hubspot_accounts (account_domain);
