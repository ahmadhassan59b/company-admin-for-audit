ALTER TABLE hubspot_accounts
  ADD COLUMN IF NOT EXISTS display_name_is_custom BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_hubspot_accounts_display_name_is_custom
  ON hubspot_accounts (display_name_is_custom);
