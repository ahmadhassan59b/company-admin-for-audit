# Audit Results JSON Compaction

## Problem

The `audit_results` table stores audit output in three JSONB columns:

- `snapshot_json`
- `rules_json`
- `report_json`

Before this change, `report_json` also stored full duplicate copies of the snapshot and rules:

- `report_json.snapshot` duplicated `snapshot_json`
- `report_json.rules` duplicated `rules_json`

That made each audit result row larger than needed.

## What Changed

`src/services/audit/report.service.js` no longer includes `snapshot` or `rules` inside the generated `report_json` payload.

The canonical data is still stored in the existing columns:

- Snapshot data remains in `audit_results.snapshot_json`
- Rules data remains in `audit_results.rules_json`
- Report summary and presentation data remains in `audit_results.report_json`

The API can still rebuild full responses from these columns when needed.

## Existing Row Cleanup

A maintenance script was added:

```bash
npm run compact:audit-results
```

The script removes duplicate nested fields from existing rows:

```sql
UPDATE audit_results
SET report_json = report_json - 'snapshot' - 'rules'
WHERE report_json ? 'snapshot'
   OR report_json ? 'rules';
```

This does not delete audits. It only removes duplicate JSON stored inside `report_json`.

## Local Result

The first compaction run reduced the local `audit_results` JSON size from:

```text
164 kB -> 89 kB
```

## Important Note

Do not run `TRUNCATE audit_results` unless the goal is to delete all saved audit result rows.
