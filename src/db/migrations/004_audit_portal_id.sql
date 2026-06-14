ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS hubspot_portal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audits_hubspot_portal_id
  ON audits (hubspot_portal_id);

