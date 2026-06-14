# HubSpot Portal Audit MCP (Phase 1 - No AI)

## Overview

This system connects to a client's HubSpot account, fetches CRM data, normalizes it, applies rule-based audits, calculates a health score, and generates a structured audit report.

Phase 1 excludes AI analysis and focuses solely on deterministic logic.

## Architecture (Phase 1)

```text
Frontend (Next.js)
        ↓
Backend API (Node.js)
        ↓
HubSpot Connector (OAuth + API)
        ↓
Data Normalization Layer
        ↓
Rule Engine
        ↓
Scoring Engine
        ↓
Report Generator
        ↓
Database (PostgreSQL)
```

## Data Sources (HubSpot APIs)

Focus on these key HubSpot API endpoints to fetch data:

- Pipelines: `GET /crm/pipelines/{objectType}`
- Workflows: `GET /automation/v4/flows`
- Forms: Forms API endpoints

## Step 1: Build Audit Snapshot

Function:

```ts
buildAuditSnapshot(rawData: any): AuditSnapshot
```

Target structure:

```ts
type AuditSnapshot = {
  pipelines: Pipeline[];
  workflows: Workflow[];
  forms: Form[];
  usage: Usage;
}
```

Example output:

```json
{
  "pipelines": [
    {
      "name": "Sales",
      "stages": 5,
      "deals_count": 120,
      "stale_deals": 34
    }
  ],
  "workflows": [
    {
      "name": "Lead Nurture",
      "status": "active",
      "last_triggered_days_ago": 45
    }
  ],
  "forms": [
    {
      "name": "Contact Us",
      "submissions_last_30_days": 0
    }
  ],
  "usage": {
    "active_users": 5,
    "total_users": 12
  }
}
```

## Step 2: Rule Engine

Function:

```ts
runAuditRules(snapshot: AuditSnapshot): RuleResult
```

Rule examples:

- Workflow inactive -> flag
- Workflow last triggered more than 30 days ago -> flag
- Pipeline stale deal ratio over 30% -> bottleneck
- Pipeline has more than 8 stages -> over-complex pipeline
- Form has zero submissions in the last 30 days -> unused form

## Step 3: Scoring Engine

Function:

```ts
calculateScore(snapshot: AuditSnapshot, rules: RuleResult): number
```

Scoring weights:

- Workflow Health: 30%
- Pipeline Health: 25%
- Form Usage: 15%
- CRM Usage: 20%
- Data Cleanliness: 10%

## Step 4: Waste Estimation

Function:

```ts
estimateWaste(snapshot: AuditSnapshot): number
```

Example logic:

- Unused users -> `$50/user`
- Unused workflows -> fixed penalty
- Inactive tools/features -> estimated cost

## Step 5: Final Report Object

Function:

```ts
generateAuditReport(snapshot, rules, score, waste): AuditReport
```

Output:

```json
{
  "score": 68,
  "issues": [
    "Workflow inactive",
    "Pipeline bottleneck"
  ],
  "waste_estimate": 500
}
```

## Step 6: API Design

Run audit:

```text
POST /api/audit/run
```

Get report:

```text
GET /api/audit/:id
```

## Step 7: Database Schema

```sql
CREATE TABLE clients (
  id SERIAL PRIMARY KEY,
  hubspot_account_id TEXT,
  access_token TEXT,
  refresh_token TEXT
);

CREATE TABLE audits (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  score INTEGER,
  waste_estimate INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_results (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id),
  snapshot_json JSONB,
  rules_json JSONB
);
```

## Step 8: Background Processing

Recommended later:

- User clicks "Run Audit"
- Create job
- Worker fetches data, runs audit, stores result

## Step 9: Frontend

Minimal page:

```text
/audit/[id]
```

Display:

- Score
- Issues list
- Waste estimate

## Phase 2 Later

- AI analysis layer
- Recommendations
- PDF reports
- Multi-client dashboards
