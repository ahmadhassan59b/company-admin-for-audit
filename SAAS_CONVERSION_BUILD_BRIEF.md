# HubSpot Audit Tool - SaaS Conversion Brief

## Goal

Turn the current local single-portal audit tool into a SaaS-ready MVP that customers can use without manually entering a HubSpot portal ID.

## Current State

The app currently works for one connected HubSpot portal because:

- OAuth is configured locally.
- Tokens are stored under a default internal account key.
- Audits can be run manually.
- Reports can be viewed by audit ID.
- Portal ID lookup works only after a portal already has a saved report.

This is useful for testing, but it is not yet a customer-facing product flow.

## SaaS Product Flow

Target customer flow:

```text
Customer opens the app
↓
Clicks Connect HubSpot
↓
Completes HubSpot OAuth
↓
Backend stores the HubSpot connection for that customer/client
↓
Customer clicks Run Audit
↓
Backend fetches their HubSpot data
↓
Backend stores the generated report
↓
Frontend redirects to the report page
```

Customer-facing URLs should look like:

```text
https://yourapp.com/connect
https://yourapp.com/audit/running
https://yourapp.com/audit/123
```

The customer should never need to type their HubSpot portal ID.

## Required Changes

### 1. Customer / Client Identity

Add a simple client identity layer.

For MVP:

- Use a generated `clientKey`.
- Store it in browser local storage or a cookie.
- Pass it through OAuth as the `state` value.
- Store HubSpot tokens against that `clientKey`.

Later:

- Replace this with real user authentication.
- Add teams, organizations, and roles.

### 2. Connect HubSpot Button

Frontend should show a button:

```text
Connect HubSpot
```

Clicking it should redirect to:

```text
/auth/hubspot?accountKey=<clientKey>
```

The backend should:

- Use `accountKey` as OAuth state.
- Store tokens under that key after callback.
- Redirect back to the frontend after successful connection.

### 3. Run Audit Button

Frontend should show:

```text
Run Audit
```

Clicking it should call:

```text
POST /api/audit/run
```

with:

```json
{
  "accountKey": "<clientKey>"
}
```

On success, redirect to:

```text
/audit/:id
```

### 4. Report Access

Reports should be fetched by audit ID:

```text
GET /api/audit/:id
```

For MVP, audit IDs can be public locally.

Later:

- Add authorization checks.
- Ensure users can only view reports for their own client account.
- Add shareable report links with signed tokens.

### 5. Deployment Requirements

For production:

- Deploy backend API.
- Deploy frontend.
- Deploy managed PostgreSQL.
- Configure environment variables.
- Update HubSpot app redirect URI to production:

```text
https://yourdomain.com/auth/hubspot/callback
```

or, if frontend and backend are separate:

```text
https://api.yourdomain.com/auth/hubspot/callback
```

### 6. Security Requirements

Before selling:

- Use HTTPS.
- Encrypt stored access and refresh tokens.
- Add real authentication.
- Add tenant isolation.
- Add rate limiting.
- Add audit ownership checks.
- Do not expose raw HubSpot tokens.

### 7. Future Billing

Billing should come after the working customer flow.

Recommended later:

- Stripe checkout
- Subscription plans
- Usage limits
- Trial flow
- Billing portal

## MVP Implementation Plan

### Phase A: Customer Flow Without Auth

- Generate `clientKey` in frontend.
- Add Connect HubSpot frontend button.
- Add Run Audit frontend button.
- Redirect to report after audit completes.
- Keep existing OAuth/token storage.
- Use `accountKey` to support multiple clients.

### Phase B: Report UX

- Add dashboard/home page.
- Show connection status.
- Show latest audit report.
- Show loading and error states.

### Phase C: SaaS Hardening

- Add auth.
- Add tenant-level access control.
- Add production deployment.
- Add billing.

## Immediate Next Build Target

Build Phase A:

- Frontend generates `clientKey`.
- Frontend can connect HubSpot.
- Backend redirects back to frontend after OAuth success.
- Frontend can run audit for that `clientKey`.
- Frontend opens the generated report automatically.
