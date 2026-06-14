const oauthService = require('../services/hubspot/oauth.service');
const oauthStateService = require('../services/hubspot/oauth-state.service');
const env = require('../config/env');
const hubspotAccountService = require('../services/hubspot/account.service');
const accountLabelService = require('../services/hubspot/account-label.service');
const securityService = require('../services/security/security.service');
const accountsCache = new Map();

function setPrivateCache(res, maxAgeSeconds = 30) {
  res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=120`);
  res.setHeader('Vary', 'Authorization');
}

function getAccountsCacheKey(tenantId, summaryOnly) {
  return `${tenantId || 'public'}:${summaryOnly ? 'summary' : 'full'}`;
}

function getCachedAccounts(tenantId, summaryOnly) {
  const key = getAccountsCacheKey(tenantId, summaryOnly);
  const cached = accountsCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    accountsCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedAccounts(tenantId, summaryOnly, value, ttlMs = 30000) {
  const key = getAccountsCacheKey(tenantId, summaryOnly);
  accountsCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function clearAccountsCache(tenantId = null) {
  const tenantPrefix = `${tenantId || 'public'}:`;
  for (const key of accountsCache.keys()) {
    if (!key.startsWith(tenantPrefix)) continue;
    accountsCache.delete(key);
  }
}

function buildFallbackAccountLabel(email, portalId) {
  const prefix = String(email || '')
    .trim()
    .split('@')[0]
    .trim();
  const safePortalId = String(portalId || '').trim();
  const format = String(env.accountLabelFormat || 'dash').toLowerCase();

  if (prefix && safePortalId) {
    if (format === 'paren') {
      return `${prefix} (${safePortalId})`;
    }
    return `${prefix} - ${safePortalId}`;
  }

  if (safePortalId) {
    return `Portal ${safePortalId}`;
  }

  return prefix || 'Account';
}

async function getConnectUrl(req, res) {
  const state = await oauthStateService.createOAuthState(req.tenantId);

  res.json({
    data: {
      url: oauthService.buildAuthorizationUrl(state)
    }
  });
}

async function listAccounts(req, res) {
  const summaryOnly = req.query.summary === '1' || req.query.summary === 'true';
  const cachedAccounts = getCachedAccounts(req.tenantId, summaryOnly);
  if (cachedAccounts) {
    setPrivateCache(res, 30);
    res.json({
      data: {
        accounts: cachedAccounts
      }
    });
    return;
  }

  let accounts = await hubspotAccountService.listTenantHubSpotAccounts(req.tenantId);
  const email = req.user && req.user.email ? String(req.user.email) : '';

  const active = accounts.find((a) => a.is_active && a.hubspot_portal_id);
  if (!summaryOnly && active && !active.display_name_is_custom && !active.account_name && !active.account_domain) {
    setImmediate(() => {
      accountLabelService
        .resolveHubSpotAccountMetadata(req.tenantId)
        .then(async (details) => {
          if (!details) return;
          const name = details.companyName || active.account_name || active.hubspot_account_name || null;
          const domain = details.hubDomain || active.account_domain || active.hubspot_account_domain || null;
          await hubspotAccountService.updateTenantHubSpotAccountMeta(req.tenantId, active.hubspot_portal_id, {
            account_name: name,
            account_domain: domain,
            account_timezone: details.timeZone || null,
            account_currency: details.currency || null,
            hubspot_account_name: name,
            hubspot_account_domain: domain,
            display_name: details.display_name || null
          });
        })
        .catch(() => {});
    });
  }

  const responseAccounts = accounts.map((account) => {
    const displayName =
      account.account_display_name ||
      account.account_name ||
      account.account_domain ||
      account.hubspot_account_name ||
      account.hubspot_account_domain ||
      buildFallbackAccountLabel(email, account.hubspot_portal_id);

    if (summaryOnly) {
      return {
        hubspot_portal_id: account.hubspot_portal_id,
        account_display_name: displayName,
        display_name: displayName,
        account_name: account.account_name || null,
        account_domain: account.account_domain || null,
        hubspot_account_name: account.hubspot_account_name || null,
        hubspot_account_domain: account.hubspot_account_domain || null,
        connected_at: account.connected_at,
        is_active: Boolean(account.is_active)
      };
    }

    return {
      ...account,
      display_name: displayName
    };
  });

  setPrivateCache(res, 30);
  setCachedAccounts(req.tenantId, summaryOnly, responseAccounts, summaryOnly ? 15000 : 30000);
  res.json({
    data: {
      accounts: responseAccounts
    }
  });
}

async function switchAccount(req, res) {
  const { portalId } = req.body || {};
  const result = await hubspotAccountService.switchActiveHubSpotAccount(req.tenantId, portalId);

  // After switching, fetch friendly account metadata using the now-active token and persist it.
  let name = null;
  let domain = null;
  try {
    const details = await accountLabelService.resolveHubSpotAccountMetadata(req.tenantId);
    name = details.companyName || null;
    domain = details.hubDomain || null;
    await hubspotAccountService.updateTenantHubSpotAccountMeta(req.tenantId, portalId, {
      account_name: name,
      account_domain: domain,
      account_timezone: details.timeZone || null,
      account_currency: details.currency || null,
      hubspot_account_name: name,
      hubspot_account_domain: domain,
      display_name: details.display_name || null
    });
  } catch (error) {
    // Ignore; switching can still succeed without it.
  }

  clearAccountsCache(req.tenantId);

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'hubspot_account_switched',
    severity: 'info',
    details: {
      portalId: String(portalId || '')
    }
  }).catch(() => {});

  res.json({
    data: result
  });
}

async function setAccountLabel(req, res) {
  const portalId = req.params.portalId;
  const { displayName } = req.body || {};
  const updated = await hubspotAccountService.setTenantHubSpotAccountDisplayName(
    req.tenantId,
    portalId,
    displayName
  );

  clearAccountsCache(req.tenantId);

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'hubspot_account_label_updated',
    severity: 'info',
    details: {
      portalId: String(portalId || ''),
      displayName: String(displayName || '')
    }
  }).catch(() => {});

  res.json({
    data: {
      hubspot_portal_id: updated.hubspot_account_id ? String(updated.hubspot_account_id) : String(portalId),
      display_name: updated.display_name || null
    }
  });
}

async function deleteAccount(req, res) {
  const portalId = req.params.portalId;
  const result = await hubspotAccountService.deleteTenantHubSpotAccount(req.tenantId, portalId);

  clearAccountsCache(req.tenantId);

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'hubspot_account_deleted',
    severity: 'info',
    details: {
      portalId: String(portalId || ''),
      nextActivePortalId: String(result.next_active_portal_id || '')
    }
  }).catch(() => {});

  res.json({
    data: result
  });
}

module.exports = {
  getConnectUrl,
  listAccounts,
  switchAccount,
  setAccountLabel,
  deleteAccount
};
