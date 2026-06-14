const hubspotClient = require('./client');

const BUSINESS_UNIT_PATHS = [
  '/business-units/public/2026-03/business-units/user/{userId}',
  '/business-units/v3/business-units/user/{userId}'
];

function normalizeBusinessUnit(unit) {
  if (!unit || typeof unit !== 'object') {
    return null;
  }

  const id = unit.id != null ? String(unit.id).trim() : null;
  const name = unit.name != null ? String(unit.name).trim() : null;

  if (!id && !name) {
    return null;
  }

  const logoMetadata =
    unit.logoMetadata && typeof unit.logoMetadata === 'object'
      ? {
          logoAltText:
            unit.logoMetadata.logoAltText != null
              ? String(unit.logoMetadata.logoAltText).trim()
              : null,
          logoUrl:
            unit.logoMetadata.logoUrl != null ? String(unit.logoMetadata.logoUrl).trim() : null,
          resizedUrl:
            unit.logoMetadata.resizedUrl != null
              ? String(unit.logoMetadata.resizedUrl).trim()
              : null
        }
      : null;

  return {
    id,
    name,
    logoMetadata
  };
}

function normalizeBusinessUnitsPayload(payload) {
  const results = Array.isArray(payload && payload.results) ? payload.results : [];
  return results.map(normalizeBusinessUnit).filter(Boolean);
}

async function fetchBusinessUnitsForUser(accountKey, userId) {
  const safeUserId = String(userId || '').trim();

  if (!safeUserId) {
    return [];
  }

  let lastError = null;

  for (const path of BUSINESS_UNIT_PATHS) {
    try {
      const payload = await hubspotClient.request(accountKey, {
        method: 'GET',
        url: path.replace('{userId}', encodeURIComponent(safeUserId))
      });

      return normalizeBusinessUnitsPayload(payload);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

async function fetchPrimaryBusinessUnit(accountKey, userId) {
  const businessUnits = await fetchBusinessUnitsForUser(accountKey, userId);
  const primary = businessUnits.find((unit) => unit && unit.name) || businessUnits[0] || null;

  if (!primary) {
    return null;
  }

  return {
    id: primary.id || null,
    name: primary.name || null,
    logoMetadata: primary.logoMetadata || null,
    count: businessUnits.length,
    results: businessUnits
  };
}

module.exports = {
  fetchBusinessUnitsForUser,
  fetchPrimaryBusinessUnit
};
