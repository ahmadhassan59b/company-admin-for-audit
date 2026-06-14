const hubspotClient = require('./client');

async function fetchAccountInfoDetails(accountKey) {
  return hubspotClient.request(accountKey, {
    method: 'GET',
    url: '/account-info/v3/details'
  });
}

async function fetchIntegrationMe(accountKey) {
  return hubspotClient.request(accountKey, {
    method: 'GET',
    url: '/integrations/v1/me'
  });
}

function normalizeDetails(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      companyName: null,
      hubDomain: null,
      uiDomain: null,
      portalId: null,
      timeZone: null,
      currency: null,
      raw: null,
      source: null
    };
  }

  const companyName =
    payload.companyName ||
    payload.company_name ||
    payload.portalName ||
    payload.portal_name ||
    payload.name ||
    null;

  const hubDomain =
    payload.hubDomain ||
    payload.hub_domain ||
    payload.domain ||
    payload.portalDomain ||
    payload.portal_domain ||
    null;
  const uiDomain = payload.uiDomain || payload.ui_domain || null;
  const portalId = payload.portalId || payload.portal_id || null;
  const timeZone =
    payload.timeZone ||
    payload.time_zone ||
    payload.timezone ||
    null;
  const currency = payload.currency || null;

  return {
    companyName: companyName ? String(companyName) : null,
    hubDomain: hubDomain ? String(hubDomain) : null,
    uiDomain: uiDomain ? String(uiDomain) : null,
    portalId: portalId != null ? String(portalId) : null,
    timeZone: timeZone ? String(timeZone) : null,
    currency: currency ? String(currency) : null
  };
}

async function fetchPortalDetails(accountKey) {
  // Best-effort strategy:
  // 1) /account-info/v3/details often includes companyName + hubDomain
  // 2) /integrations/v1/me often includes hub_domain; use it as fallback label
  try {
    const details = await fetchAccountInfoDetails(accountKey);
    return { ...normalizeDetails(details), raw: details, source: 'account-info' };
  } catch (error) {
    const me = await fetchIntegrationMe(accountKey);
    return { ...normalizeDetails(me), raw: me, source: 'integrations-me' };
  }
}

module.exports = {
  fetchPortalDetails
};
