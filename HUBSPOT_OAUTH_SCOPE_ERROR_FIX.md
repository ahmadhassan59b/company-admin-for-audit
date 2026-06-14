# HubSpot OAuth Scope Error Fix (SaaS Integration Guide)

## Overview

When connecting a different HubSpot account, you may encounter an error like:

```text
Authorization failed because the provided scopes are missing [...]
```

This is not always a bug in your system. It is typically a **scope mismatch** between your app’s requested permissions and what the client’s HubSpot account can grant.

---

# Why This Happens

The error typically includes scopes such as:

```text
crm.schemas.deals.read
crm.objects.companies.read
crm.schemas.contacts.read
crm.schemas.companies.read
```

This occurs due to one or more of the following:

## 1. Insufficient User Permissions

- The user connecting the account is not an Admin
- Some scopes require elevated permissions

## 2. HubSpot Plan Limitations

- Certain APIs (especially schema APIs) are not available on lower-tier plans

## 3. Over-requested Scopes

- Your app is requesting more permissions than necessary for your current functionality

---

# Important Clarification

Clients do NOT manually add scopes.

- Scopes are defined in your HubSpot app configuration
- Users only approve or deny access
- If HubSpot rejects scopes, that portal cannot grant them

---

# Recommended Solution (MVP-Friendly)

## Reduce Required Scopes

Remove all schema-related scopes for now:

```text
crm.schemas.deals.read
crm.schemas.contacts.read
crm.schemas.companies.read
```

## Use Minimal Working Scope Set

```text
crm.objects.deals.read
crm.objects.contacts.read
automation
forms
```

Note: HubSpot scope naming varies in documentation. In this repo we use `automation` and `forms` (not `automation.read` / `forms.read`).

This is sufficient for:

- Pipelines
- Workflows
- Forms
- Basic CRM object reads

---

# Expected Result After Fix

## Before

```text
OAuth fails → user cannot connect
```

## After

```text
OAuth succeeds → audit runs successfully (with partial data if needed)
```

---

# Optional Improvements

## 1. Graceful Degradation

Your system should handle different access levels:

```text
Client A → full data access
Client B → limited data access
```

Design audits to:

- Skip unavailable data sources
- Still produce a report
- Include a low-severity issue like: "Some data could not be fetched with the current HubSpot permissions"

## 2. User Feedback (UX)

If connection fails due to permissions:

```text
"This HubSpot account does not have required permissions.
Please connect using an Admin account."
```

## 3. Advanced (Future)

Implement fallback logic:

```text
Try full scopes
↓
If fails → retry with minimal scopes
```

---

# Debug Checklist

- [ ] Remove `crm.schemas.*` scopes from HubSpot app
- [ ] Update OAuth request scopes in backend (`HUBSPOT_SCOPES`)
- [ ] Reconnect HubSpot account (re-authorize)
- [ ] Verify audit still runs with reduced data

---

# Saved Scope Sets (For Later)

Minimal (recommended for MVP):

```text
crm.objects.contacts.read crm.objects.deals.read forms automation
```

Add Companies (only if you implement Companies fetches):

```text
crm.objects.contacts.read crm.objects.deals.read crm.objects.companies.read forms automation
```

Schema/Properties (enterprise / advanced; more likely to fail on lower plans):

```text
crm.objects.contacts.read crm.objects.deals.read crm.objects.companies.read crm.schemas.contacts.read crm.schemas.deals.read crm.schemas.companies.read forms automation
```

---

# Future (Phase 3+)

You can reintroduce advanced scopes later when:

- Targeting enterprise clients
- Building deeper CRM analysis features
- Handling schema-level insights

---

# Summary

This issue is caused by:

- Over-requesting scopes
- Client portal limitations

Fix it by:

- Reducing scopes to minimum required
- Supporting partial data access
- Improving user-facing permission errors
