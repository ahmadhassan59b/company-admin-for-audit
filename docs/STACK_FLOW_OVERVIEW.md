# HubSpot Audit Tool (MVP) – Stack, Architecture, and Flow

This document is written to explain the system end-to-end for stakeholders (product/engineering/ops). It summarizes what we built, how it works, and what comes next.

## 1) What This Product Does

The HubSpot Audit Tool connects to a HubSpot portal via OAuth, fetches key CRM configuration and usage signals, normalizes the data into a compact snapshot, runs deterministic (rules-based) audits, computes a health score and waste estimate, and returns a structured report JSON that is viewable in the UI.

Optional: an AI layer can generate “consultant-style” insights from the snapshot + issues (OpenAI or local Ollama/Gemma).

## 2) Current Tech Stack

Backend (API)
- Node.js
- Express
- Axios (HubSpot OAuth + API calls)
- dotenv (env config)
- PostgreSQL (token + tenant + audit persistence)

Database
- Postgres via `pg`
- SQL migrations under `src/db/migrations/`

Frontend (UI)
- A lightweight UI server (`scripts/ui-server.js`) serving static pages from `ui-static/`
- UI is plain HTML/CSS/JS
- Charts via Chart.js (served locally as `/static/vendor/chart.umd.js`)

AI (Optional)
- OpenAI (cloud API) using `openai` SDK
- Ollama (local models) fallback, tested with `gemma2:2b`
- Zod for strict JSON validation of AI outputs

## 3) Repository Structure (High Level)

Top-level
- `src/` backend code (Express + services)
- `ui-static/` static UI pages (login, dashboard, audit report)
- `scripts/` migrate + UI server
- `docs/` documentation and sample output

Backend breakdown
- `src/app.js`: Express app setup, middleware, routes
- `src/server.js`: server start
- `src/config/env.js`: env validation + config
- `src/config/db.js`: Postgres connection
- `src/routes/*`: API routing
- `src/controllers/*`: request handlers
- `src/services/hubspot/*`: OAuth, token refresh, HubSpot fetchers
- `src/services/audit/*`: snapshot, rules, scoring, reporting
- `src/ai/*`: AI providers (OpenAI/Ollama), prompt + schema + ai_score
- `src/utils/*`: logger and error handling

## 4) Core Data Model (Multi-Tenant SaaS Foundation)

This build supports SaaS-style isolation:

- `tenants`: an organization/account in our app
- `users`: users belong to a tenant
- `hubspot_accounts`: multiple HubSpot portals can be connected per tenant
- `audits`: audit runs associated to a tenant + a specific portal
- `audit_results`: stores snapshot JSON + rules JSON + report JSON

Portal switching
- A tenant may have multiple connected portals.
- The UI supports selecting an active portal.
- Audit history on the dashboard is filtered to the active portal.

## 5) HubSpot OAuth + Token Handling

OAuth routes
- `GET /auth/hubspot` redirects to HubSpot authorization URL
- `GET /auth/hubspot/callback` receives `code`, exchanges for tokens, stores tokens, and redirects back to UI

Token persistence
- Access token + refresh token are stored in Postgres
- Token expiry is stored as a timestamp
- Token refresh runs automatically when token is expired or near expiry

Security note
- Tokens are stored encrypted at rest using `TOKEN_ENCRYPTION_KEY` (or a safe fallback in config if not provided).
- Tokens are never exposed to the frontend.

OAuth scopes (MVP-minimal)
- Default `HUBSPOT_SCOPES`:
  - `crm.objects.contacts.read`
  - `crm.objects.deals.read`
  - `forms`
  - `automation`

We intentionally keep scopes minimal to reduce installation failures across customer portals with plan/permission limitations.

## 6) HubSpot Data We Fetch (MVP Domains)

We focus on the “audit snapshot” inputs and keep raw HubSpot responses out of the audit engine.

1) Pipelines (Deals)
- Pipelines + stages (deal pipelines)
- Pipeline deal stats:
  - total deals in pipeline
  - stale deals count (best-effort heuristics from deal activity/updated signals)

2) Workflows (Automation)
- Workflow list
- Status: active/inactive (enabled/archived)
- “last_triggered_days_ago” computed from lastTouched signals

3) Forms
- Form list (id, name)
- Best-effort “submissions_last_30_days” per form
  - If a portal does not permit submission stats, the snapshot marks it as unavailable and the audit degrades gracefully.

4) Usage (Feature usage signal)
- Best-effort user list to compute:
  - active users
  - total users
- If not accessible with current scopes/permissions, it’s marked as unavailable.

5) CRM Properties (Data cleanliness / complexity)
- Contact and deal properties (best-effort)
- Counts total and custom properties to detect complexity
- If unavailable, audit degrades gracefully.

## 7) Normalized Snapshot (What Rules and AI Consume)

We transform HubSpot responses into a compact snapshot:

```json
{
  "pipelines": [{ "id": "...", "name": "...", "stages": 5, "deals_count": 120, "stale_deals": 34 }],
  "workflows": [{ "id": "...", "name": "...", "status": "active", "last_triggered_days_ago": 45 }],
  "forms": [{ "id": "...", "name": "...", "submissions_last_30_days": 0, "submissions_available": true }],
  "usage": { "active_users": 5, "total_users": 12, "status": "available" },
  "data_cleanliness": {
    "status": "available",
    "custom_contact_properties": 348,
    "custom_deal_properties": 302,
    "total_contact_properties": 757,
    "total_deal_properties": 1274
  },
  "capabilities": { "pipelines": "available", "workflows": "available", "forms": "available", "properties": "available" }
}
```

## 8) Deterministic Audit (Rules + Score + Waste)

Rule engine
- Generates an `issues[]` list and category counts (`by_category`).

Examples of rules implemented:
- Workflows inactive or stale (no recent use)
- Pipeline complexity and bottlenecks (stale_deals ratio, too many stages)
- Forms unused (0 submissions in last 30 days when data available)
- Excessive custom properties (data model complexity)

Scoring engine
- Produces a 0–100 score based on category health weights:
  - workflows health
  - pipeline health
  - form usage
  - CRM usage
  - data cleanliness

Waste estimation
- Estimates “waste” based on unused assets and usage gaps (conservative heuristic).

## 9) Optional AI Analysis Layer (Insights)

Purpose
- Converts structured audit data into human-readable consulting insights and recommendations.
- Output is strict JSON validated by Zod.

Providers
- OpenAI (cloud) when `OPENAI_API_KEY` is set
- Ollama (local) when `OLLAMA_BASE_URL` is set (e.g. Gemma)

Behavior
- AI is only run if requested (we call `POST /api/audit/run?ai=true`) and a provider is configured.
- AI output is stored in `audit_results.report_json` under `ai`.
- `ai_score` is computed as a blended score using deterministic score + AI risk level.

## 10) API Endpoints (Key)

Health
- `GET /health`

Auth (our SaaS login)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`

HubSpot connect and portal management
- `GET /api/hubspot/connect-url` (returns OAuth URL)
- `GET /api/hubspot/accounts` (list connected portals for tenant)
- `POST /api/hubspot/switch` (switch active portal)

Audit
- `POST /api/audit/run?ai=true|false` (run new audit; optionally includes AI)
- `GET /api/audit/:id` (fetch report by audit id)
- `GET /api/audit/portal/:portalId/latest` (get latest report for a portal)
- `POST /api/audit/:id/ai` (generate AI for an existing audit without refetching HubSpot)

## 11) UI Experience (What the User Sees)

Pages (served from `ui-static/`)
- `/login`: login/register
- `/dashboard`: connect portal, run audit, see history, charts
- `/audit/:id`: report view (score, breakdown charts, issues list, AI insights when present)

Portal switching
- HubSpot-style account dropdown in navbar lists all connected portals and allows switching.

AI audit loading
- “Run audit” shows an AI-style loading overlay with rotating stage text and then redirects to the report.

## 12) Deployment Notes (MVP-Friendly)

Recommended free MVP stack (works well for demos)
- Backend: Render (HTTPS + simple deploy; free tier may sleep/cold start)
- Database: Neon Postgres (drop-in; watch connection/cold start)
- Frontend: Cloudflare Pages (static hosting + HTTPS)

OAuth redirect URI (must match exactly in HubSpot Developer App)
- `HUBSPOT_REDIRECT_URI=https://api.<domain>/auth/hubspot/callback`

## 13) Known Limitations (MVP)

- Some HubSpot portals cannot grant all APIs due to plan/permissions; we handle this by:
  - requesting minimal scopes, and
  - gracefully degrading audits when certain data is unavailable.
- Audit run time can be high for portals with many forms/workflows (no background job queue yet).
- “Feature usage” is limited to best-effort user counts and availability signals in Phase 1.
- No billing, no notifications, no job queue/worker separation yet.

## 14) Next Steps (Product-Ready Improvements)

Operational
- Add a job queue (BullMQ/Redis) for audit runs to prevent request timeouts and improve UX.
- Add rate-limit/backoff tuning and caching for HubSpot calls.

Product
- More “usage” signals (email sends, form conversion, workflow enrollments if accessible).
- Report sharing (public share link with token) and downloadable PDF.
- Permissions messaging in UI (e.g., “connect using a Super Admin” guidance).

AI
- Add Claude provider (Anthropic) as an additional AI option.
- Implement model fallback strategy and structured recommendation grouping.

