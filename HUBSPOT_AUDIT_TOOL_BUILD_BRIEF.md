# HubSpot Audit Tool — Codex Build Brief

## Objective
Build an MVP backend for a HubSpot audit tool that connects to a user's HubSpot account via OAuth, pulls core CRM configuration data, normalizes it, runs a basic rules-based audit, and returns a structured audit JSON response.

## Primary Goal
The backend should let a user:
1. Click **Connect HubSpot**
2. Complete HubSpot OAuth
3. Store access and refresh tokens securely
4. Fetch data from HubSpot
5. Normalize the data
6. Run an initial audit
7. Return a structured report JSON

## Tech Stack
Use:
- Node.js
- Express
- Axios
- dotenv
- PostgreSQL for token and audit storage

Keep the code modular and production-oriented.

## MVP Scope
Only include these HubSpot domains:
- Deal pipelines
- Workflows
- Forms
- CRM properties for contacts and deals

Do not build:
- frontend
- billing
- notifications
- background jobs
- complex analytics
- full user auth system

Assume there is one internal team/user for now, but design the storage layer so multi-tenant support can be added later.

## Required Backend Features

### 1. OAuth Routes
Create:
- `GET /auth/hubspot`
- `GET /auth/hubspot/callback`

Behavior:
- `/auth/hubspot` redirects user to HubSpot OAuth install URL
- `/auth/hubspot/callback` receives `code`, exchanges it for tokens, and stores them

Environment variables:
- `PORT`
- `APP_BASE_URL`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `HUBSPOT_REDIRECT_URI`
- `DATABASE_URL`

### 2. Token Management
Implement:
- access token storage
- refresh token storage
- expiry timestamp
- automatic refresh when token is expired or near expiry

Create a reusable token service.

### 3. HubSpot API Fetchers
Create service functions to fetch:

#### Pipelines
- `GET /crm/v3/pipelines/deals`

#### Workflows
Use a current HubSpot workflows endpoint compatible with OAuth and the `automation` scope.

#### Forms
Use a current HubSpot forms endpoint compatible with OAuth.

#### Properties
- `GET /crm/v3/properties/contacts`
- `GET /crm/v3/properties/deals`

The code should gracefully handle pagination where applicable.

### 4. Internal Normalization Layer
Do not pass raw HubSpot responses directly to the audit engine.

Normalize data into compact objects.

Example target shapes:

```js
{
  id: "workflow_id",
  name: "Lead Nurture Workflow",
  enabled: true,
  type: "CONTACT_BASED",
  lastTriggeredAt: null
}
{
  id: "pipeline_id",
  label: "Sales Pipeline",
  stages: [
    { id: "stage_id", label: "Qualified" }
  ]
}
{
  id: "form_id",
  name: "Demo Request",
  createdAt: null,
  updatedAt: null
}
```

### 5. Audit Engine
Create a basic rules-based audit engine.

Initial rules:

- Flag if more than 5 deal pipelines exist
- Flag workflows that appear inactive or disabled
- Flag forms that appear unused or stale if there is enough metadata
- Flag suspicious CRM complexity such as too many custom properties

Return:

- `healthScore` from 0 to 100
- `issues` array
- `recommendations` array
- `summary` counts

Example output shape:

```json
{
  "healthScore": 72,
  "summary": {
    "pipelineCount": 4,
    "workflowCount": 12,
    "formCount": 6,
    "contactPropertyCount": 85,
    "dealPropertyCount": 48
  },
  "issues": [
    {
      "severity": "high",
      "category": "workflows",
      "title": "Multiple workflows appear inactive",
      "detail": "5 workflows are disabled or show signs of no recent use."
    }
  ],
  "recommendations": [
    {
      "priority": "high",
      "title": "Review inactive workflows",
      "detail": "Disable, delete, or consolidate workflows with no recent activity."
    }
  ]
}
```

### 6. Audit Endpoint
Create:

- `POST /audit/run`

Behavior:

- Load valid HubSpot token
- Fetch pipelines, workflows, forms, and properties
- Normalize all data
- Run audit engine
- Return final audit JSON

### 7. Health Endpoint
Create:

- `GET /health`

Return basic server status.

## Project Structure

Use a clean folder structure like:

```text
src/
  app.js
  server.js
  config/
    env.js
    db.js
  routes/
    auth.routes.js
    audit.routes.js
    health.routes.js
  controllers/
    auth.controller.js
    audit.controller.js
  services/
    hubspot/
      oauth.service.js
      token.service.js
      pipelines.service.js
      workflows.service.js
      forms.service.js
      properties.service.js
    audit/
      normalize.service.js
      score.service.js
      audit.service.js
  db/
    migrations/
  utils/
    logger.js
    errors.js
```

## Database Requirements

Use PostgreSQL.

Create tables for:

### `hubspot_connections`

Store:

- internal account/team key
- hubspot portal/account id if available
- access token
- refresh token
- token expiry
- created_at
- updated_at

### `audit_runs`

Store:

- internal account/team key
- raw summary JSON
- audit result JSON
- created_at

Use SQL migrations.

## Code Quality Requirements

- Use async/await
- Add error handling middleware
- Validate required env vars on startup
- Keep functions small and modular
- Add comments where needed, but do not over-comment
- Use clear naming
- Avoid unnecessary abstraction
- Return consistent JSON responses

## Deliverables

Generate:

- Full backend code
- PostgreSQL schema/migration files
- `.env.example`
- Setup instructions in `README.md`
- Example API calls for testing with curl
- One sample audit JSON response

## Implementation Notes

- Make reasonable choices when HubSpot endpoints differ by version, but keep the code easy to update
- Prefer production-safe patterns over shortcuts
- If a HubSpot endpoint is uncertain, isolate it behind a service module so it can be swapped later
- Keep multi-tenant support in mind, even if the first pass uses a single internal team key

## What to Avoid

Do not:

- build the frontend
- use in-memory token storage
- hardcode secrets
- couple raw HubSpot responses directly to audit logic
- add AI report generation yet

This phase is backend foundation only.

## Final Request

Build the complete backend MVP described above.

Also include:

- exact commands to install and run locally
- how to set the HubSpot redirect URI
- how to test the OAuth flow
- how to call `/audit/run`

If any HubSpot API endpoint choice is ambiguous, make a pragmatic implementation choice and clearly document it in the README.
