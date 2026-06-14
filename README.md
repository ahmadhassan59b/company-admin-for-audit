# HubSpot Audit Tool Backend

Backend MVP for connecting a HubSpot account with OAuth, fetching core CRM configuration, normalizing the data, running a rules-based audit, and storing audit runs in PostgreSQL.

## Stack

- Node.js 18+
- Express
- Axios
- PostgreSQL
- dotenv

## Local Setup

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env
# Fill in HubSpot credentials in .env

docker compose -f compose-local.yml up --build
```

Open `http://localhost:3001`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production deployment and Docker Hub setup.

### Option B — Node.js on the host

1. Install dependencies:

```bash
npm install
```

2. Create a PostgreSQL database:

```bash
createdb hubspot_audit_tool
```

3. Create your environment file:

```bash
cp .env.example .env
```

4. Fill in `.env` with your HubSpot app credentials and database URL.

5. Run migrations:

```bash
npm run migrate
```

6. Start the server:

```bash
npm run dev
```

For production-style startup:

```bash
npm start
```

## Environment Variables

Required:

- `PORT`
- `APP_BASE_URL`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `HUBSPOT_REDIRECT_URI`
- `DATABASE_URL`

Optional:

- `INTERNAL_ACCOUNT_KEY`: defaults to `default-team`
- `TOKEN_ENCRYPTION_KEY`: used to encrypt stored OAuth tokens. If omitted, the app derives the encryption key from `HUBSPOT_CLIENT_SECRET`.
- `HUBSPOT_SCOPES`: defaults to `crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read crm.schemas.contacts.read crm.schemas.companies.read crm.schemas.deals.read forms oauth`
- `HUBSPOT_OPTIONAL_SCOPES`: defaults to `automation`
- `GOOGLE_CLIENT_ID`: enables the Google sign-in button on the login page. Add your frontend origin in Google Cloud Console as an authorized JavaScript origin.
- `EMAIL_FROM`: sender address for verification emails, for example `HubAudit <no-reply@your-domain.com>`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`: SMTP settings used to send verification emails. For Gmail SSL, use `SMTP_PORT=465` and `SMTP_SECURE=true`.
- `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`: verification link lifetime, defaults to `60`
- `OPENAI_API_KEY`: enables Phase 3 AI analysis (optional)
- `OPENAI_MODEL`: defaults to `gpt-5.4-mini`

## HubSpot Redirect URI

In your HubSpot developer app settings, set the redirect URL to match:

```text
http://localhost:3000/auth/hubspot/callback
```

That value must exactly match `HUBSPOT_REDIRECT_URI` in `.env`.

For deployed environments, use your public base URL:

```text
https://your-domain.com/auth/hubspot/callback
```

## OAuth Flow Test

1. Start the server.

2. Open this URL in a browser:

```text
http://localhost:3000/auth/hubspot
```

3. Complete the HubSpot install flow.

4. HubSpot redirects back to `/auth/hubspot/callback`; the backend exchanges the code for tokens, encrypts them, and stores them in `hubspot_connections`.

You can also pass a future tenant key:

```text
http://localhost:3000/auth/hubspot?accountKey=team-a
```

## API Calls

Health check:

```bash
curl http://localhost:3000/health
```

Run an audit for the default internal account:

```bash
curl -X POST http://localhost:3000/audit/run \
  -H "Content-Type: application/json" \
  -d "{}"
```

Run the Phase 1 deterministic report audit:

```bash
curl -X POST http://localhost:3000/api/audit/run \
  -H "Content-Type: application/json" \
  -d "{}"
```

Run the Phase 1 report audit + optional AI analysis (requires `OPENAI_API_KEY`):

```bash
curl -X POST "http://localhost:3000/api/audit/run?ai=true" \
  -H "Content-Type: application/json" \
  -d "{}"
```

Get a saved Phase 1 report:

```bash
curl http://localhost:3000/api/audit/1
```

Run an audit for a specific internal account key:

```bash
curl -X POST http://localhost:3000/audit/run \
  -H "Content-Type: application/json" \
  -d "{\"accountKey\":\"team-a\"}"
```

## Audit Response Shape

```json
{
  "data": {
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
        "title": "Workflows appear inactive or disabled",
        "detail": "5 workflows are disabled or archived."
      }
    ],
    "recommendations": [
      {
        "priority": "high",
        "title": "Review inactive workflows",
        "detail": "Disable, delete, or consolidate workflows with no recent activity or clear owner."
      }
    ]
  }
}
```

A standalone sample is available at `docs/sample-audit-response.json`.

## HubSpot Endpoint Choices

The backend isolates each HubSpot domain behind a service module so endpoints can be swapped without touching the audit engine.

Current choices:

- Deal pipelines: `GET /crm/v3/pipelines/deals`
- Workflows: `GET /automation/v4/flows`
- Forms: `GET /marketing/v3/forms`
- Contact properties: `GET /crm/v3/properties/contacts`
- Deal properties: `GET /crm/v3/properties/deals`
- OAuth token exchange and refresh: `POST /oauth/v3/token`
- Token metadata: `GET /oauth/v1/access-tokens/{accessToken}`

Notes:

- HubSpot Workflows v4 is currently documented as beta and requires the `automation` OAuth scope.
- HubSpot Forms v3 requires the `forms` OAuth scope.
- Pagination is handled for endpoints that return `results` and `paging.next.after`.

## Database

Migration files live in `src/db/migrations`.

Tables:

- `hubspot_connections`: one row per internal account/team key, with encrypted access and refresh tokens.
- `audit_runs`: stores each audit result and summary JSON for historical inspection.
- `clients`: Phase 1 client records linked to the HubSpot portal.
- `audits`: Phase 1 audit score and waste estimate rows.
- `audit_results`: Phase 1 snapshot, rules, and final report JSON.

Run migrations with:

```bash
npm run migrate
```

## Minimal Frontend

The Phase 1 report viewer lives in `frontend/`.

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3001/audit/1
```

In this workspace, ports `3001` and `3002` were already occupied, so the current local frontend is running on:

```text
http://localhost:3100
```

## SaaS-Style Local Flow

The frontend supports a SaaS-style flow with local email/password auth:

1. Open:

```text
http://localhost:3100
```

2. Create an account or log in.

3. If you create a new account, the app sends a verification email and keeps the account pending until the link is clicked.

4. Open the verification link at `/verify-email?token=...`.

5. Log in after verification.

6. Open the dashboard.

7. Click **Connect HubSpot**.

8. Complete OAuth.

9. The backend stores HubSpot tokens under your tenant.

10. Click **Run Audit**.

11. The frontend calls:

```text
POST http://localhost:3000/api/audit/run
```

with your bearer token, then redirects to:

```text
http://localhost:3100/audit/:id
```

The old browser-generated `clientKey` flow is still supported for migration. If a user signs up from a browser that already has a Phase 1 `clientKey`, the backend attempts to migrate that HubSpot connection to the new tenant.

Phase 2 local auth endpoints:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/resend-verification
GET /api/auth/verify-email
GET /api/auth/me
GET /api/hubspot/connect-url
```

Protected audit endpoints accept:

```text
Authorization: Bearer <token>
```

## Project Structure

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

## Source References

- HubSpot Workflows v4 API: https://developers.hubspot.com/docs/api-reference/automation-automation-v4-v4/guide
- HubSpot Forms v3 API: https://developers.hubspot.com/docs/api-reference/marketing-forms-v3/forms/post-marketing-v3-forms-
- HubSpot Pipelines API: https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide
- HubSpot Properties API: https://developers.hubspot.com/docs/api-reference/latest/crm/properties/get-properties
- HubSpot OAuth v3: https://developers.hubspot.com/docs/api-reference/auth-oauth-v3/guide
