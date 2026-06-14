# HubAudit Company Admin Dashboard

HubAudit connects to HubSpot, stores tenant and audit data in PostgreSQL, and exposes a company admin dashboard for managing customers, selected packages, billing, revenue, expiring packages, new customers, pending payments, and audit activity.

The active browser entry point is the company dashboard:

```text
http://localhost:3001/admin
```

Legacy `/dashboard/...` UI routes redirect to `/admin`.

## Stack

- Node.js 24 in Docker, Node.js 18+ for local development
- Express
- PostgreSQL 17
- Chart.js
- Docker Compose
- HubSpot OAuth

## Run With Docker Compose

1. Copy the environment template:

```powershell
copy .env.example .env
```

2. Fill the required values in `.env`:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `HUBSPOT_REDIRECT_URI`
- `TOKEN_ENCRYPTION_KEY`
- `AUTH_JWT_SECRET`

3. Start Docker Desktop.

4. Run the app:

```powershell
docker compose up --build
```

5. Open:

```text
http://localhost:3001/admin
```

Services:

- UI: `http://localhost:3001`
- Backend API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

Useful commands:

```powershell
docker compose ps
docker compose logs -f
docker compose down
```

## Run Without Docker

Use this when you already have PostgreSQL running locally.

```powershell
npm install
npm run migrate
```

Start the backend:

```powershell
npm start
```

Start the UI server in another terminal:

```powershell
$env:UI_PORT='3001'
$env:API_BASE_URL='http://127.0.0.1:3000'
npm run ui
```

Open:

```text
http://localhost:3001/admin
```

## Environment Variables

Required application values:

- `PORT`
- `APP_BASE_URL`
- `FRONTEND_BASE_URL`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `HUBSPOT_REDIRECT_URI`
- `DATABASE_URL`
- `TOKEN_ENCRYPTION_KEY`
- `AUTH_JWT_SECRET`

Docker Compose values:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `BACKEND_PORT`
- `UI_PORT`
- `ADMIN_DASHBOARD_REQUIRE_AUTH`

Important production settings:

- `NODE_ENV=production`
- `ADMIN_DASHBOARD_REQUIRE_AUTH=true`
- Use strong unique values for `TOKEN_ENCRYPTION_KEY`, `AUTH_JWT_SECRET`, and `POSTGRES_PASSWORD`.
- Do not expose PostgreSQL directly to the public internet.

## HubSpot Redirect URI

For local development, configure this URL in your HubSpot developer app:

```text
http://localhost:3000/auth/hubspot/callback
```

That value must match `HUBSPOT_REDIRECT_URI` in `.env`.

For production, use your public domain:

```text
https://your-domain.com/auth/hubspot/callback
```

## Company Admin Dashboard

The admin UI reads live data from PostgreSQL through:

```text
GET /api/admin/dashboard
```

The dashboard uses these tables:

- `tenants`
- `users`
- `audits`
- `audit_packages`
- `customer_subscriptions`
- `billing_invoices`
- `billing_payments`

The dashboard displays:

- total customers
- active customers
- selected plans
- customers by plan
- revenue this month
- monthly recurring revenue
- expiring packages
- new customers
- pending payments
- audit count and average score

In local development, `ADMIN_DASHBOARD_REQUIRE_AUTH=false` allows local preview from localhost. In production, set `ADMIN_DASHBOARD_REQUIRE_AUTH=true`.

## API Auth

Auth endpoints:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/resend-verification
GET /api/auth/verify-email
GET /api/auth/me
```

Protected requests use:

```text
Authorization: Bearer <token>
```

Audit run and report JSON routes require authentication:

```text
POST /api/audit/run
GET /api/audit/:id
GET /api/audit/:id/summary
GET /api/audit/:id/object/:objectType
GET /api/audit/:id/details/:section
GET /api/audit/portal/:portalId/latest
```

Health endpoints are public:

```text
GET /health
GET /health/version
GET /health/details
```

## Database

Migration files live in:

```text
src/db/migrations
```

Run migrations manually with:

```powershell
npm run migrate
```

The Docker backend service runs migrations before starting the API.

## Docker Hub Deployment

Create two Docker Hub repositories:

- `hubaudit-backend`
- `hubaudit-ui`

Build rules:

- Backend Dockerfile: `Dockerfile.backend`
- UI Dockerfile: `Dockerfile.ui`
- Build context: `/`

Remote deployment can use:

```bash
DOCKERHUB_NAMESPACE=your-dockerhub-user IMAGE_TAG=latest docker compose -f compose.prod.yml up -d
```

See [docs/DOCKER_DEPLOYMENT.md](docs/DOCKER_DEPLOYMENT.md) for the deployment runbook.

## Security Notes

- `.env` is ignored by git and is not copied into Docker images.
- Admin dashboard data is auth-protected in production.
- Audit run and audit report JSON endpoints require authentication.
- HubSpot OAuth tokens are encrypted before storage.
- Browser auth tokens are currently stored in `localStorage`; moving sessions to `HttpOnly; Secure; SameSite` cookies is recommended before a high-risk public launch.
- Run a senior/security review before exposing the app publicly.

## Project Structure

```text
compose.yml
compose.prod.yml
Dockerfile.backend
Dockerfile.ui
scripts/
  ui-server.js
  migrate.js
src/
  app.js
  server.js
  config/
  controllers/
  db/migrations/
  middleware/
  routes/
  services/
ui-admin/
  index.html
  admin.css
  admin.js
ui-static/
  login.html
  audit.html
  styles.css
frontend/
  legacy Next.js frontend
```

## Source References

- Docker Compose: https://docs.docker.com/compose/
- Docker Hub: https://hub.docker.com/
- HubSpot OAuth v3: https://developers.hubspot.com/docs/api-reference/auth-oauth-v3/guide
- HubSpot Workflows v4 API: https://developers.hubspot.com/docs/api-reference/automation-automation-v4-v4/guide
- HubSpot Forms v3 API: https://developers.hubspot.com/docs/api-reference/marketing-forms-v3/forms/post-marketing-v3-forms-
- HubSpot Pipelines API: https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide
- HubSpot Properties API: https://developers.hubspot.com/docs/api-reference/latest/crm/properties/get-properties
