const axios = require('axios');

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED']);

async function requestWithRetry(config, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 3;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 1000;
  const retryableStatusCodes = options.retryableStatusCodes || RETRYABLE_STATUS_CODES;
  const retryableErrorCodes = options.retryableErrorCodes || RETRYABLE_ERROR_CODES;
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await axios.request(config);
    } catch (error) {
      const statusCode = error.response ? error.response.status : null;
      const errorCode = error.code || null;
      const retryAfterMs = getRetryDelayMs(error, attempt, baseDelayMs);
      const shouldRetry =
        attempt < retries &&
        (retryableStatusCodes.has(statusCode) ||
          (statusCode === null && errorCode && retryableErrorCodes.has(errorCode)));

      if (!shouldRetry) {
        throw error;
      }

      if (onRetry) {
        onRetry(error, {
          attempt: attempt + 1,
          delayMs: retryAfterMs,
          statusCode,
          errorCode,
          config
        });
      }

      await sleep(retryAfterMs);
    }
  }

  return null;
}

async function safeCall(fn, fallback = null, onError = null) {
  try {
    return await fn();
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }

    return fallback;
  }
}

function getRetryDelayMs(error, attempt, baseDelayMs) {
  const retryAfter = error.response && error.response.headers
    ? error.response.headers['retry-after']
    : null;

  if (retryAfter && !Number.isNaN(Number(retryAfter))) {
    return Number(retryAfter) * 1000;
  }

  return baseDelayMs * (attempt + 1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  requestWithRetry,
  safeCall
};
