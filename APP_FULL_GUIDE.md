# HubSpot Audit Tool - Full App Guide

## Overview

HubSpot Audit Tool is a local-first audit workspace for inspecting a HubSpot portal, scoring portal health, and presenting both deterministic findings and AI-assisted insights.

The app currently has three major parts:

- Backend API in `src/`
- Static UI in `ui-static/` served by `scripts/ui-server.js`
- Optional Next.js frontend in `frontend/`

The main deployed flow in this workspace is:

1. User signs up or logs in
2. User connects a HubSpot portal
3. Backend stores OAuth tokens securely
4. User runs an audit
5. App stores deterministic findings and optional AI output
6. Report page shows audit summary, sections, recommendations, and AI insight controls

## Stack

- Node.js 18+
- Express
- PostgreSQL
- Axios
- Zod
- Helmet
- express-rate-limit
- HubSpot OAuth
- OpenRouter AI with GPT-OSS

## Main Runtime Pieces

### Backend

The backend is the API and data layer.

Key responsibilities:

- Auth: register, login, session verification
- HubSpot OAuth connect flow
- HubSpot token storage and refresh
- HubSpot account switching
- Audit execution and report persistence
- AI report generation and background job tracking

Primary backend entry points:

- `src/server.js`
- `src/app.js`

### Static UI

The static UI lives in `ui-static/` and is served by:

- `scripts/ui-server.js`

That server:

- serves HTML, CSS, and JS from `ui-static/`
- proxies `/api`, `/auth`, and `/health` to the backend
- serves Chart.js locally from `node_modules`

The static UI is the current primary browser experience.

### Optional Next.js Frontend

There is also a Next.js app in `frontend/`.

It can be deployed separately, but the main current flow in this repo is the static UI under `ui-static/`.

## User Flows

### 1. Sign up / Log in

The UI posts to:

- `POST /api/auth/register`
- `POST /api/auth/login`

Successful login stores a JWT in browser storage.

### 2. Connect HubSpot

The dashboard calls:

- `GET /api/hubspot/connect-url`

The backend redirects the user through the HubSpot OAuth install flow and receives the callback at:

- `/auth/hubspot/callback`

### 3. Run Audit

The dashboard calls:

- `POST /api/audit/run`

The backend:

- fetches HubSpot data
- normalizes it
- computes a deterministic score
- stores the result
- optionally generates AI output

### 4. View Report

The report page loads:

- `GET /api/audit/:id`

If a report is requested by portal ID instead of audit ID, the UI can fall back to:

- `GET /api/audit/portal/:portalId/latest`

### 5. AI Insight

The report page includes:

- Fast AI
- Full AI
- background job tracking
- notification bar status updates

Fast AI uses a compact prompt pack.
Full AI uses a larger prompt pack and can continue in the background.

## Data Model

### Tenants

The app is multi-tenant.

Each user belongs to one tenant.
Each tenant can have one or more HubSpot portal connections.

### HubSpot Connections

Stored in the database with encrypted tokens and portal metadata.

### Audits

Audits are tenant-scoped and now use tenant-scoped audit numbers for display.

This means:

- Tenant 1 can have Audit #1, #2, #3
- Tenant 2 can also have Audit #1, #2, #3

The database row ID is not the same as the display number.

## Important Environment Variables

Required backend env vars:

- `PORT`
- `APP_BASE_URL`
- `FRONTEND_BASE_URL`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `HUBSPOT_REDIRECT_URI`
- `DATABASE_URL`

Auth and crypto:

- `AUTH_JWT_SECRET`
- `TOKEN_ENCRYPTION_KEY`

HubSpot:

- `HUBSPOT_SCOPES`
  - Include `crm.schemas.companies.read` when connecting HubSpot. The app uses company schema access during account setup and audit setup.

AI:

- `AI_PROVIDER`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_APP_NAME`
- `AI_PROMPT_MODE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Optional local fallback:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

UI:

- `UI_PORT`
- `API_BASE_URL`

Account label format:

- `ACCOUNT_LABEL_FORMAT`

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

### 3. Fill backend env vars

Set:

- `DATABASE_URL`
- `APP_BASE_URL`
- `FRONTEND_BASE_URL`
- `HUBSPOT_CLIENT_ID`
- `HUBSPOT_CLIENT_SECRET`
- `HUBSPOT_REDIRECT_URI`
- `AUTH_JWT_SECRET`
- `TOKEN_ENCRYPTION_KEY`

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start the backend

```bash
npm start
```

### 6. Start the static UI

```bash
npm run ui
```

### 7. Open the app

- Backend health: `http://localhost:3000/health`
- Static UI: `http://localhost:3001/`

## Local HubSpot OAuth

For local development, set the redirect URI to:

```text
http://localhost:3000/auth/hubspot/callback
```

This must match the value in your HubSpot app settings.

## Deployment Layout

### Recommended current stack

- Database: Neon
- Backend: Render Web Service
- Frontend: Render Web Service for the static UI

### Backend Render settings

- Build command: `npm install`
- Start command: `node src/server.js`

### Frontend Render settings

- Build command: `npm install`
- Start command: `npm run ui`
- Environment variables:
  - `API_BASE_URL=https://<backend-url>`
  - `UI_PORT=10000` if needed for the selected Render runtime

### HubSpot redirect URL on production

Use:

```text
https://<backend-url>/auth/hubspot/callback
```

## Important API Routes

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

HubSpot:

- `GET /api/hubspot/connect-url`
- `GET /api/hubspot/accounts`
- `POST /api/hubspot/switch`
- `POST /api/hubspot/accounts/:portalId/label`

Audit:

- `GET /api/audit`
- `POST /api/audit/run`
- `GET /api/audit/:id`
- `POST /api/audit/:id/ai`

OAuth callback:

- `GET /auth/hubspot/callback`

Health:

- `GET /health`

## Audit Output

The report page shows:

- overall score
- section cards
- section detail view
- score inputs
- top issues
- AI insight banner
- modal insight viewer

The deterministic report includes data such as:

- pipeline movement
- automation coverage
- feature utilization
- score breakdowns
- recommendations

AI output is stored separately by prompt mode when available:

- `compact` for Fast AI
- `full` for Full AI

## UI Behavior

### Skeleton loading

The app now uses app-wide skeleton overlays to reduce layout shift and avoid text flashing before data is ready.

### Account names

Account labels can be:

- manually renamed
- auto-generated from HubSpot metadata
- formatted using a fallback pattern

### Audit numbering

Audit numbers are tenant-scoped.

### AI behavior

- Fast AI runs with a compact prompt pack
- Full AI can run in the background
- the navbar notification bar shows AI job status
- toggling AI mode changes the selected result, not necessarily a rerun

## Database Migrations

The repo currently includes migrations for:

- base schema
- phase 1 audit reports
- auth and tenants
- portal ID support
- account title and display name support
- tenant-scoped audit numbers
- custom account display names

Run them with:

```bash
npm run migrate
```

## Project Structure

```text
src/
  app.js
  server.js
  config/
  controllers/
  db/
  middleware/
  routes/
  services/
  utils/
ui-static/
frontend/
scripts/
```

## Notes

- Secrets should stay in `.env` or Render environment variables.
- Do not hardcode API keys in the UI.
- The static UI depends on the backend API being reachable.
- The backend must have the same `HUBSPOT_REDIRECT_URI` that is registered in the HubSpot app settings.

## Short Version

If you only remember one deployment path for this repo:

1. Put the database on Neon
2. Deploy backend on Render
3. Deploy static UI on Render
4. Point HubSpot redirect URI to the backend callback
5. Add `API_BASE_URL` and `FRONTEND_BASE_URL` correctly
