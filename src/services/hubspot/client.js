const tokenService = require('./token.service');
const { AppError } = require('../../utils/errors');
const { requestWithRetry } = require('../../utils/httpClient');

const HUBSPOT_API_BASE_URL = 'https://api.hubapi.com';

async function request(accountKey, config, options = {}) {
  let accessToken = await tokenService.getValidAccessToken(accountKey, {
    forceRefresh: Boolean(options.forceRefresh)
  });
  let refreshedAfterUnauthorized = Boolean(options.forceRefresh);

  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const response = await requestWithRetry(
        {
          baseURL: HUBSPOT_API_BASE_URL,
          ...config,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(config.headers || {})
          }
        },
        {
          retries: Number.isFinite(options.retries) ? options.retries : 4,
          baseDelayMs: Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 1000,
          onRetry: options.onRetry
        }
      );

      return response.data;
    } catch (error) {
      const statusCode = error.response ? error.response.status : null;

      if (statusCode === 401 && !refreshedAfterUnauthorized) {
        accessToken = await tokenService.getValidAccessToken(accountKey, {
          forceRefresh: true
        });
        refreshedAfterUnauthorized = true;
        continue;
      }

      throw toHubSpotApiError(error, config);
    }
  }
}

async function getPagedResults(accountKey, path, params = {}) {
  const results = [];
  let after = params.after;
  const maxResults = Number.isFinite(Number(params.maxResults)) && Number(params.maxResults) > 0
    ? Number(params.maxResults)
    : Infinity;

  do {
    const data = await request(accountKey, {
      method: 'GET',
      url: path,
      params: {
        ...params,
        after
      }
    });

    if (Array.isArray(data.results)) {
      results.push(...data.results);
    }

    if (results.length >= maxResults) {
      results.length = maxResults;
      break;
    }

    after = data.paging && data.paging.next ? data.paging.next.after : null;
  } while (after);

  return results;
}

module.exports = {
  request,
  getPagedResults
};

function toHubSpotApiError(error, config) {
  const statusCode = error.response ? error.response.status : 502;
  const details = error.response && error.response.data ? error.response.data : null;
  const hubspotMessage =
    details && (details.message || details.error_description || details.error);

  const appError = new AppError(
    hubspotMessage || `HubSpot API request failed for ${config.url}`,
    statusCode >= 500 ? 502 : 400,
    'hubspot_api_request_failed'
  );

  appError.details = {
    endpoint: config.url,
    statusCode,
    hubspot: details
  };

  return appError;
}
