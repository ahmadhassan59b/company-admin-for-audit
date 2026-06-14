# Docker Runbook

## Local Compose

1. Copy `.env.example` to `.env`.
2. Fill required app secrets and the local Postgres values:
   - `POSTGRES_DB`
   - `POSTGRES_USER`
   - `POSTGRES_PASSWORD`
   - `TOKEN_ENCRYPTION_KEY`
   - `AUTH_JWT_SECRET`
   - HubSpot OAuth values
3. Start Docker Desktop.
4. Run:

```powershell
docker compose up --build
```

The UI is available at `http://localhost:3001/admin`. The backend listens on `http://localhost:3000`.

## Docker Hub Auto Builds

Create two Docker Hub repositories and build rules from this Git repo:

- `hubaudit-backend`
  - Dockerfile: `Dockerfile.backend`
  - Build context: `/`
- `hubaudit-ui`
  - Dockerfile: `Dockerfile.ui`
  - Build context: `/`

Use `latest` for the default branch and a semver tag rule for releases.

## Remote Compose

On the server, provide a production `.env` with real secrets and an external `DATABASE_URL`, then run:

```bash
DOCKERHUB_NAMESPACE=your-dockerhub-user IMAGE_TAG=latest docker compose -f compose.prod.yml up -d
```

For public deployment:

- set `NODE_ENV=production`
- set `ADMIN_DASHBOARD_REQUIRE_AUTH=true`
- do not expose Postgres to the public internet
- put TLS in front of the UI with a reverse proxy/load balancer
- rotate any secrets that were used during local development

## Security Notes

- Health endpoints are public by design.
- Login, registration, email verification, and HubSpot OAuth callback are public by design.
- Admin dashboard data is auth-protected in production.
- Audit run and report JSON routes require authentication.
- The app still stores browser auth tokens in `localStorage`; moving sessions to `HttpOnly; Secure; SameSite` cookies is recommended before a high-risk public launch.
