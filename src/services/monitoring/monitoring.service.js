const env = require('../../config/env');
const logger = require('../../utils/logger');

const state = {
  startedAt: Date.now(),
  requests: [],
  recentAlerts: [],
  totals: {
    requests: 0,
    errors: 0,
    slowRequests: 0
  }
};

function getWindowMs() {
  return Number.isFinite(Number(env.monitoringWindowMs))
    ? Number(env.monitoringWindowMs)
    : 5 * 60 * 1000;
}

function getSlowRequestThresholdMs() {
  return Number.isFinite(Number(env.monitoringSlowRequestMs))
    ? Number(env.monitoringSlowRequestMs)
    : 2000;
}

function getErrorRateAlertThreshold() {
  return Number.isFinite(Number(env.monitoringErrorRateAlertThreshold))
    ? Number(env.monitoringErrorRateAlertThreshold)
    : 0.1;
}

function getAlertCooldownMs() {
  return Number.isFinite(Number(env.monitoringAlertCooldownMs))
    ? Number(env.monitoringAlertCooldownMs)
    : 5 * 60 * 1000;
}

function getMinRequestsForAlert() {
  return Number.isFinite(Number(env.monitoringMinRequestsForAlert))
    ? Number(env.monitoringMinRequestsForAlert)
    : 25;
}

function prune(now = Date.now()) {
  const cutoff = now - getWindowMs();
  while (state.requests.length > 0 && state.requests[0].time < cutoff) {
    state.requests.shift();
  }
}

function recordRequest(entry) {
  const now = Date.now();
  const normalized = {
    time: now,
    method: entry.method || 'GET',
    path: entry.path || '/',
    statusCode: Number(entry.statusCode) || 0,
    durationMs: Number(entry.durationMs) || 0,
    tenantId: entry.tenantId || null,
    requestId: entry.requestId || null
  };

  state.requests.push(normalized);
  state.totals.requests += 1;
  if (normalized.statusCode >= 500) {
    state.totals.errors += 1;
  }
  if (normalized.durationMs >= getSlowRequestThresholdMs()) {
    state.totals.slowRequests += 1;
    emitAlert('slow_request', {
      method: normalized.method,
      path: normalized.path,
      statusCode: normalized.statusCode,
      durationMs: normalized.durationMs,
      requestId: normalized.requestId
    });
  }

  prune(now);
  evaluateHealth(now);
}

function evaluateHealth(now = Date.now()) {
  prune(now);

  const windowRequests = state.requests.length;
  const windowErrors = state.requests.filter((request) => request.statusCode >= 500).length;
  const errorRate = windowRequests > 0 ? windowErrors / windowRequests : 0;

  if (windowRequests < getMinRequestsForAlert()) {
    return;
  }

  if (errorRate >= getErrorRateAlertThreshold()) {
    emitAlert('high_error_rate', {
      windowRequests,
      windowErrors,
      errorRate,
      threshold: getErrorRateAlertThreshold()
    });
  }
}

function emitAlert(type, details = {}) {
  const now = Date.now();
  const cooldownMs = getAlertCooldownMs();
  const recent = state.recentAlerts.find(
    (alert) => alert.type === type && now - alert.time < cooldownMs
  );

  if (recent) return;

  const payload = {
    type,
    ...details,
    windowMs: getWindowMs(),
    slowRequestThresholdMs: getSlowRequestThresholdMs(),
    errorRateThreshold: getErrorRateAlertThreshold()
  };

  state.recentAlerts.push({
    type,
    time: now,
    payload
  });

  state.recentAlerts = state.recentAlerts.filter((alert) => now - alert.time < cooldownMs);

  logger.warn('monitoring_alert', payload);
}

function getStatus() {
  prune();

  const windowRequests = state.requests.length;
  const windowErrors = state.requests.filter((request) => request.statusCode >= 500).length;
  const windowSlow = state.requests.filter(
    (request) => request.durationMs >= getSlowRequestThresholdMs()
  ).length;
  const errorRate = windowRequests > 0 ? windowErrors / windowRequests : 0;

  return {
    started_at: new Date(state.startedAt).toISOString(),
    uptime_seconds: Math.floor((Date.now() - state.startedAt) / 1000),
    window_ms: getWindowMs(),
    totals: { ...state.totals },
    window: {
      requests: windowRequests,
      errors: windowErrors,
      slow_requests: windowSlow,
      error_rate: Number(errorRate.toFixed(4))
    },
    thresholds: {
      slow_request_ms: getSlowRequestThresholdMs(),
      error_rate_alert: getErrorRateAlertThreshold(),
      min_requests_for_alert: getMinRequestsForAlert(),
      alert_cooldown_ms: getAlertCooldownMs()
    },
    recent_alerts: state.recentAlerts.slice(-10).map((alert) => ({
      type: alert.type,
      time: new Date(alert.time).toISOString(),
      payload: alert.payload
    }))
  };
}

module.exports = {
  recordRequest,
  getStatus,
  emitAlert
};
