const env = require('../config/env');
const oauthService = require('../services/hubspot/oauth.service');
const oauthStateService = require('../services/hubspot/oauth-state.service');
const tokenService = require('../services/hubspot/token.service');
const hubspotAccountService = require('../services/hubspot/account.service');
const accountLabelService = require('../services/hubspot/account-label.service');
const securityService = require('../services/security/security.service');
const { AppError } = require('../utils/errors');

async function redirectToHubSpot(req, res) {
  const accountKey = Array.isArray(req.query.accountKey)
    ? req.query.accountKey[0]
    : req.query.accountKey || env.internalAccountKey;
  const state = await oauthStateService.createOAuthState(accountKey);
  const installUrl = oauthService.buildAuthorizationUrl(state);

  res.redirect(installUrl);
}

async function handleCallback(req, res) {
  const { code, error, error_description: errorDescription, state } = req.query;

  if (error) {
    const wantsJson =
      req.query.response === 'json' ||
      (req.headers.accept && req.headers.accept.includes('application/json'));

    if (wantsJson) {
      throw new AppError(errorDescription || error, 400, 'hubspot_oauth_error');
    }

    const redirectUrl = new URL('/admin', env.frontendBaseUrl);
    redirectUrl.searchParams.set('hubspotError', String(error));
    if (errorDescription) {
      redirectUrl.searchParams.set('hubspotErrorDescription', String(errorDescription));
    }
    res.redirect(redirectUrl.toString());
    return;
  }

  if (!code) {
    throw new AppError('Missing OAuth code', 400, 'missing_oauth_code');
  }

  const accountKey = await oauthStateService.loadOAuthState(state);
  const tokenPayload = await oauthService.exchangeCodeForTokens(code);
  const metadata = await oauthService.getAccessTokenMetadata(tokenPayload.access_token);

  await tokenService.upsertConnection(accountKey, tokenPayload, metadata);
  await maybeSyncTenantHubSpotAccount(accountKey, metadata);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  await securityService.logSecurityEvent({
    tenantId: uuidPattern.test(accountKey) ? accountKey : null,
    eventType: 'hubspot_connected',
    severity: 'info',
    details: {
      hubspotPortalId: metadata.hub_id || metadata.hubId || null
    }
  }).catch(() => {});

  const hubspotPortalId = metadata.hub_id || metadata.hubId || null;
  const wantsJson =
    req.query.response === 'json' ||
    (req.headers.accept && req.headers.accept.includes('application/json'));

  if (wantsJson) {
    await oauthStateService.invalidateOAuthState(state);
    res.json({
      data: {
        connected: true,
        accountKey,
        hubspotPortalId
      }
    });
    return;
  }

  const redirectUrl = new URL('/connected', env.frontendBaseUrl);
  redirectUrl.searchParams.set('accountKey', accountKey);
  if (hubspotPortalId) {
    redirectUrl.searchParams.set('portalId', hubspotPortalId);
  }

  await oauthStateService.invalidateOAuthState(state);
  res.redirect(redirectUrl.toString());
}

async function maybeSyncTenantHubSpotAccount(accountKey, metadata = null) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(accountKey)) {
    return;
  }

  const connection = await tokenService.getConnection(accountKey);
  if (connection) {
    let details = null;
    try {
      details = await accountLabelService.resolveHubSpotAccountMetadata(accountKey, {
        metadata
      });
    } catch (error) {
      // Portal and brand details are optional; do not block OAuth completion.
      details = null;
    }

    try {
      await hubspotAccountService.upsertHubSpotAccountForTenant(accountKey, connection, details || {});
    } catch (error) {
      // Account metadata sync is best-effort. If the live DB schema is behind, keep OAuth completion working.
      console.warn('hubspot_account_metadata_sync_failed', {
        accountKey,
        code: error && error.code ? error.code : null,
        message: error && error.message ? error.message : String(error)
      });
    }
  }
}

module.exports = {
  redirectToHubSpot,
  handleCallback
};
