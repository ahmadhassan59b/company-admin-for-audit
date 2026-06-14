CREATE TABLE IF NOT EXISTS audit_number_counters (
  scope TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS audit_number INTEGER;

WITH numbered AS (
  SELECT
    id,
    CASE
      WHEN tenant_id IS NOT NULL THEN 'tenant:' || tenant_id::text
      ELSE 'client:' || client_id::text
    END AS scope,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN tenant_id IS NOT NULL THEN 'tenant:' || tenant_id::text
          ELSE 'client:' || client_id::text
        END
      ORDER BY created_at, id
    ) AS rn
  FROM audits
)
UPDATE audits a
SET audit_number = numbered.rn
FROM numbered
WHERE a.id = numbered.id;

ALTER TABLE audits
  ALTER COLUMN audit_number SET NOT NULL;

INSERT INTO audit_number_counters (scope, last_number, updated_at)
SELECT
  CASE
    WHEN tenant_id IS NOT NULL THEN 'tenant:' || tenant_id::text
    ELSE 'client:' || client_id::text
  END AS scope,
  MAX(audit_number) AS last_number,
  NOW() AS updated_at
FROM audits
GROUP BY 1
ON CONFLICT (scope)
DO UPDATE SET
  last_number = GREATEST(audit_number_counters.last_number, EXCLUDED.last_number),
  updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_tenant_audit_number
  ON audits (tenant_id, audit_number)
  WHERE tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audits_client_audit_number
  ON audits (client_id, audit_number)
  WHERE tenant_id IS NULL;
