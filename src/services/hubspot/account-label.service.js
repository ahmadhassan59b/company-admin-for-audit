const tokenService = require('./token.service');
const oauthService = require('./oauth.service');
const portalDetailsService = require('./portal-details.service');
const businessUnitsService = require('./business-units.service');

function getUserIdFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata.user_id || metadata.userId || metadata.signed_access_token?.userId || null;
}

async function resolveHubSpotAccountMetadata(accountKey, options = {}) {
  let tokenMetadata = options.metadata || null;

  if (!tokenMetadata) {
    try {
      const accessToken = await tokenService.getValidAccessToken(accountKey);
      tokenMetadata = await oauthService.getAccessTokenMetadata(accessToken);
    } catch (error) {
      tokenMetadata = null;
    }
  }

  const userId = getUserIdFromMetadata(tokenMetadata);
  const hubId = tokenMetadata && (tokenMetadata.hub_id || tokenMetadata.hubId || tokenMetadata.signed_access_token?.hubId) || null;
  const hubDomainFromToken = tokenMetadata && (tokenMetadata.hub_domain || tokenMetadata.hubDomain) || null;
  const userEmail = tokenMetadata && (tokenMetadata.user || tokenMetadata.email) || null;

  const [portalDetails, primaryBusinessUnit] = await Promise.all([
    portalDetailsService.fetchPortalDetails(accountKey).catch(() => null),
    userId ? businessUnitsService.fetchPrimaryBusinessUnit(accountKey, userId).catch(() => null) : Promise.resolve(null)
  ]);

  const portalName = portalDetails && portalDetails.companyName ? String(portalDetails.companyName).trim() : null;
  const portalDomain = portalDetails && portalDetails.hubDomain ? String(portalDetails.hubDomain).trim() : null;
  const uiDomain = portalDetails && portalDetails.uiDomain ? String(portalDetails.uiDomain).trim() : null;
  const portalId = portalDetails && portalDetails.portalId ? String(portalDetails.portalId).trim() : null;
  const brandName = primaryBusinessUnit && primaryBusinessUnit.name ? String(primaryBusinessUnit.name).trim() : null;
  const brandId = primaryBusinessUnit && primaryBusinessUnit.id ? String(primaryBusinessUnit.id).trim() : null;
  const displayName =
    brandName ||
    portalName ||
    hubDomainFromToken ||
    portalDomain ||
    null;

  return {
    tokenMetadata,
    userId,
    hubId,
    userEmail,
    portalDetails,
    businessUnit: primaryBusinessUnit,
    brandName,
    brandId,
    companyName: portalName,
    hubDomain: hubDomainFromToken || portalDomain,
    uiDomain,
    portalId,
    timeZone: portalDetails && portalDetails.timeZone ? String(portalDetails.timeZone).trim() : null,
    currency: portalDetails && portalDetails.currency ? String(portalDetails.currency).trim() : null,
    account_name: portalName,
    account_domain: portalDomain,
    account_timezone: portalDetails && portalDetails.timeZone ? String(portalDetails.timeZone).trim() : null,
    account_currency: portalDetails && portalDetails.currency ? String(portalDetails.currency).trim() : null,
    hubspot_account_name: portalName,
    hubspot_account_domain: portalDomain,
    display_name: displayName,
    displayName
  };
}

module.exports = {
  resolveHubSpotAccountMetadata
};
