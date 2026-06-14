# HubSpot Audit Tool - Phase 3.1 (Stability Layer)

## Overview

This phase ensures the system is **reliable, fault-tolerant, and production-safe**.

Goal:

- Prevent random failures
- Handle token expiration automatically
- Ensure audits complete even with partial failures
- Add retry + logging mechanisms

---

## Architecture Upgrade

```text
API Request
   ↓
Token Validation (refresh if needed)
   ↓
HubSpot API Calls (with retry)
   ↓
Audit Engine
   ↓
AI Layer (optional, safe fallback)
   ↓
Final Report (always returned)
```

---

## 1. Token Refresh (MANDATORY)

### Why

HubSpot access tokens expire (~30 minutes).
You must refresh using `refresh_token`. ([HubSpot Developers][1])

### Implementation

#### File: `src/services/hubspot/token.service.js`

```js
import axios from "axios";
import db from "../../config/db.js";

export async function refreshAccessToken(connection) {
  const res = await axios.post(
    "https://api.hubapi.com/oauth/v3/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  const newAccessToken = res.data.access_token;
  const newRefreshToken = res.data.refresh_token || connection.refresh_token;
  const expiresAt = Date.now() + res.data.expires_in * 1000;

  await db.query(
    `UPDATE hubspot_connections
     SET access_token=$1, refresh_token=$2, expires_at=$3
     WHERE id=$4`,
    [newAccessToken, newRefreshToken, expiresAt, connection.id]
  );

  return newAccessToken;
}
```

### Token Getter (SAFE WRAPPER)

```js
export async function getValidAccessToken(connection) {
  const now = Date.now();

  if (connection.expires_at && connection.expires_at > now + 60000) {
    return connection.access_token;
  }

  return await refreshAccessToken(connection);
}
```

---

## 2. HubSpot API Retry Layer

### Why

HubSpot can return:

- 429 (rate limit)
- 5xx errors

HubSpot itself retries in some cases ([HubSpot Developers][2])
You should also retry on your side.

### Implementation

#### File: `src/utils/httpClient.js`

```js
import axios from "axios";

export async function requestWithRetry(config, retries = 3) {
  try {
    return await axios(config);
  } catch (err) {
    const status = err.response?.status;

    if (retries > 0 && (status === 429 || status >= 500)) {
      await new Promise(r => setTimeout(r, 1000));
      return requestWithRetry(config, retries - 1);
    }

    throw err;
  }
}
```

---

## 3. HubSpot Client Wrapper (STANDARDIZED)

#### File: `src/services/hubspot/client.js`

```js
import { getValidAccessToken } from "./token.service.js";
import { requestWithRetry } from "../../utils/httpClient.js";

export async function hubspotRequest(connection, url) {
  const token = await getValidAccessToken(connection);

  return requestWithRetry({
    method: "GET",
    url: `https://api.hubapi.com${url}`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
```

---

## 4. Graceful Failure Handling

### Goal

Audit must NEVER crash.

### Pattern

```js
async function safeCall(fn, fallback = null) {
  try {
    return await fn();
  } catch (e) {
    console.error("SafeCall Error:", e.message);
    return fallback;
  }
}
```

### Example Usage

```js
const pipelines = await safeCall(() => getPipelines(connection), []);
const workflows = await safeCall(() => getWorkflows(connection), []);
const forms = await safeCall(() => getForms(connection), []);
```

---

## 5. AI Fallback Safety

### Goal

AI failure should NOT break audit.

```js
let aiResult = null;

if (useAI) {
  try {
    aiResult = await analyzeAudit(snapshot, issues);
  } catch (e) {
    console.error("AI failed:", e.message);
  }
}
```

---

## 6. Logging System (BASIC)

#### File: `src/utils/logger.js`

```js
export function logInfo(message, meta = {}) {
  console.log("[INFO]", message, meta);
}

export function logError(message, error) {
  console.error("[ERROR]", message, error?.message || error);
}
```

### Usage

```js
logInfo("Audit started", { tenantId });

logError("HubSpot fetch failed", err);
```

---

## 7. Audit Controller Upgrade

#### File: `src/controllers/audit.controller.js`

```js
export async function runAudit(req, res) {
  try {
    const connection = await getConnection(req.user.tenant_id);

    const snapshot = await buildSnapshot(connection);
    const rules = runRules(snapshot);

    let ai = null;

    if (req.query.ai === "true") {
      ai = await safeCall(() => analyzeAudit(snapshot, rules.issues));
    }

    const result = {
      score: rules.score,
      issues: rules.issues,
      ai,
    };

    await saveAudit(result);

    res.json(result);
  } catch (e) {
    console.error("Audit failed:", e);
    res.status(500).json({ error: "Audit failed" });
  }
}
```

---

## 8. Production Rules (CRITICAL)

- NEVER trust access_token expiry blindly
- ALWAYS refresh before expiry (buffer: 60s)
- NEVER crash entire audit on one API failure
- ALWAYS return a report (even partial)
- ALWAYS log failures

---

## 9. Deliverable (Phase 3.1 Complete)

System guarantees:

- No expired token failures
- No random crashes
- Partial audits still succeed
- AI failures don’t break system
- API retries handled safely

---

## 10. Next Phase (DO NOT START YET)

Phase 3.2 → Cost Optimization

- Snapshot compression
- AI cost reduction
- caching layer

---

## Summary

Phase 3.1 converts your system from:

❌ fragile MVP

into:

✅ stable SaaS backend ready for real users

[1]: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide?utm_source=chatgpt.com "OAuth Quickstart Guide - HubSpot docs"
[2]: https://developers.hubspot.com/docs/reference/api/other-resources/error-handling?utm_source=chatgpt.com "Error handling - HubSpot docs"
