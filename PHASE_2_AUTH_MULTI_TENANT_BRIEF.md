# HubSpot Audit Tool - Phase 2 (Auth + Multi-Tenant SaaS)

## Overview

This phase upgrades the system from a temporary `clientKey`-based identity model to a real SaaS architecture with authentication and tenant isolation.

Goal:

- Add user authentication
- Introduce tenants / organizations
- Secure all data access
- Maintain backward compatibility with existing Phase 1 users

## Core Architecture Upgrade

Before:

```text
clientKey -> HubSpot Tokens -> Audits
```

After:

```text
User -> Tenant -> HubSpot Accounts -> Audits
```

## 1. Database Schema

### tenants

```sql
id UUID PRIMARY KEY
name TEXT
created_at TIMESTAMPTZ
```

### users

```sql
id UUID PRIMARY KEY
email TEXT
password_hash TEXT NULL
tenant_id UUID REFERENCES tenants(id)
created_at TIMESTAMPTZ
```

### hubspot_accounts

```sql
id UUID PRIMARY KEY
tenant_id UUID REFERENCES tenants(id)
hubspot_account_id TEXT
access_token TEXT
refresh_token TEXT
connected_at TIMESTAMPTZ
```

### audits

```sql
id UUID PRIMARY KEY
tenant_id UUID REFERENCES tenants(id)
hubspot_account_id UUID REFERENCES hubspot_accounts(id)
score INTEGER
waste_estimate INTEGER
created_at TIMESTAMPTZ
```

### audit_results

```sql
id UUID PRIMARY KEY
audit_id UUID REFERENCES audits(id)
snapshot_json JSONB
rules_json JSONB
```

### migration_client_keys

```sql
client_key TEXT
tenant_id UUID REFERENCES tenants(id)
migrated_at TIMESTAMPTZ
```

## 2. Authentication Layer

Recommended options:

- NextAuth.js
- Clerk
- Auth0

MVP implementation can use email/password with signed HTTP/API tokens, then swap to a managed auth provider later.

Requirements:

- Users must log in before accessing dashboard
- Each user belongs to exactly one tenant for now
- Backend exposes middleware:

```ts
requireAuth(req) -> user
requireTenant(req) -> tenant_id
```

## 3. Tenant Creation Flow

On first login/signup:

```text
User signs up
Create tenant
Attach user to tenant
```

Later:

- Multiple users per tenant
- Role system

## 4. OAuth Refactor

Before:

```text
OAuth state = clientKey
```

After:

```text
OAuth state = tenant_id
```

Flow:

```text
User logged in
Clicks Connect HubSpot
Redirect to HubSpot OAuth with state=tenant_id
Callback receives code + state
Exchange code for tokens
Store tokens under tenant_id
```

## 5. API Refactor

All APIs must be tenant-aware.

Run audit:

```http
POST /api/audit/run
```

Backend flow:

```text
Get logged-in user
Resolve tenant_id
Fetch HubSpot account for tenant
Fetch HubSpot data
Build snapshot
Run rules
Calculate score
Store audit under tenant_id
```

Get audit:

```http
GET /api/audit/:id
```

Security check:

```ts
if (audit.tenant_id !== user.tenant_id) {
  throw Unauthorized
}
```

## 6. Migration From Phase 1

Goal: do not lose existing users.

Strategy:

1. When a request comes with `clientKey`, check if it exists.
2. If not migrated, create a tenant, map `clientKey -> tenant_id`, and move/copy HubSpot tokens.
3. Store mapping in `migration_client_keys`.
4. After migration, ignore `clientKey` and use `tenant_id`.

## 7. Frontend Changes

New pages:

- `/login`
- `/dashboard`
- `/connect`

Dashboard shows:

- Connected HubSpot account
- Audit history
- Run Audit button

Remove the clientKey logic after migration is complete.

## 8. Security Requirements

Mandatory for SaaS:

- Enforce authentication on protected routes
- Enforce tenant isolation on all queries
- Encrypt HubSpot tokens at rest
- Use HTTPS only in production
- Do not expose tokens in frontend

## 9. Background Jobs

Recommended later:

```text
User clicks Run Audit
Create job
Worker fetches HubSpot data, runs audit, stores result
```

## 10. Optional Enhancements

- Multiple HubSpot accounts per tenant
- Audit history trends
- Shareable reports
- Roles

## 11. Updated System Flow

```text
User logs in
User connects HubSpot
Tenant stores HubSpot tokens
User runs audit
Audit stored under tenant
User views report securely
```

## 12. Phase 2 Goal

After this phase, the system becomes:

- Real SaaS
- Multi-user and multi-client
- Secure by tenant
- Ready for billing integration

## 13. Phase 3

- AI analysis layer
- PDF reports
- Billing with Stripe
- Usage limits
- Team collaboration
