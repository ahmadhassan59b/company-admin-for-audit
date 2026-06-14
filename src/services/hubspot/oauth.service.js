const env = require('../../config/env');
const { AppError } = require('../../utils/errors');
const { requestWithRetry } = require('../../utils/httpClient');

const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v3/token';
const HUBSPOT_TOKEN_METADATA_URL = 'https://api.hubapi.com/oauth/v1/access-tokens';

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: env.hubspotClientId,
    redirect_uri: env.hubspotRedirectUri,
    state
  });

  if (env.hubspotRequiredScopes) {
    params.set('scope', env.hubspotRequiredScopes);
  }

  if (env.hubspotOptionalScopes) {
    params.set('optional_scope', env.hubspotOptionalScopes);
  }

  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.hubspotClientId,
    client_secret: env.hubspotClientSecret,
    redirect_uri: env.hubspotRedirectUri,
    code
  });

  try {
    const response = await requestWithRetry(
      {
        method: 'POST',
        url: HUBSPOT_TOKEN_URL,
        data: body.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      },
      {
        retries: 2
      }
    );

    return response.data;
  } catch (error) {
    throw toHubSpotError(error, 'HubSpot token exchange failed');
  }
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.hubspotClientId,
    client_secret: env.hubspotClientSecret,
    refresh_token: refreshToken
  });

  try {
    const response = await requestWithRetry(
      {
        method: 'POST',
        url: HUBSPOT_TOKEN_URL,
        data: body.toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      },
      {
        retries: 2
      }
    );

    return response.data;
  } catch (error) {
    throw toHubSpotError(error, 'HubSpot token refresh failed');
  }
}

async function getAccessTokenMetadata(accessToken) {
  try {
    const response = await requestWithRetry(
      {
        method: 'GET',
        url: `${HUBSPOT_TOKEN_METADATA_URL}/${accessToken}`
      },
      {
        retries: 2
      }
    );
    return response.data;
  } catch (error) {
    throw toHubSpotError(error, 'HubSpot token metadata lookup failed');
  }
}

function toHubSpotError(error, fallbackMessage) {
  const statusCode = error.response ? error.response.status : 502;
  const details = error.response && error.response.data ? error.response.data : null;
  const hubspotMessage =
    details && (details.message || details.error_description || details.error);

  const appError = new AppError(
    hubspotMessage || fallbackMessage,
    statusCode >= 500 ? 502 : 400,
    'hubspot_oauth_request_failed'
  );

  appError.details = details;
  return appError;
}

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getAccessTokenMetadata
};
