function log(level, message, meta = {}) {
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...normalizeMeta(meta)
  };

  const writer = level === 'error' ? console.error : console.log;
  writer(JSON.stringify(payload));
}

function normalizeMeta(meta) {
  if (meta instanceof Error) {
    return {
      error: serializeError(meta)
    };
  }

  if (!meta || typeof meta !== 'object') {
    return { meta };
  }

  return deepNormalize(meta);
}

function deepNormalize(value) {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepNormalize(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, deepNormalize(entry)])
  );
}

function serializeError(error) {
  return {
    message: error.message || 'Unknown error',
    code: error.code || null,
    stack: error.stack || null,
    details: error.details || null
  };
}

module.exports = {
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta)
};
