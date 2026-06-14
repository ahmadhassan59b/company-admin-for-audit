const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const logger = require('./utils/logger');
const monitoring = require('./services/monitoring/monitoring.service');
const authRoutes = require('./routes/auth.routes');
const authApiRoutes = require('./routes/auth-api.routes');
const hubspotApiRoutes = require('./routes/hubspot.routes');
const auditRoutes = require('./routes/audit.routes');
const apiAuditRoutes = require('./routes/api-audit.routes');
const securityRoutes = require('./routes/security.routes');
const adminRoutes = require('./routes/admin.routes');
const healthRoutes = require('./routes/health.routes');
const { errorHandler, notFoundHandler } = require('./utils/errors');

const app = express();

function getLocalFrontendBaseUrl() {
  return (process.env.FRONTEND_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
}

function prefersHtml(req) {
  return req.accepts(['html', 'json']) === 'html';
}

// Render sits behind a proxy, so trust the first hop for rate-limit IP detection.
app.set('trust proxy', 1);

app.use(compression());

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use((req, res, next) => {
  const allowedOrigins = new Set([
    'http://localhost:3100',
    'http://127.0.0.1:3100',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ]);
  if (env.frontendBaseUrl) {
    allowedOrigins.add(env.frontendBaseUrl);
  }
  const origin = req.headers.origin;

  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  req.logger = logger;
  req.requestStartedAt = Date.now();
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    monitoring.recordRequest({
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      tenantId: req.tenantId || null,
      requestId
    });

    logger.info('request_completed', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      tenantId: req.tenantId || null
    });
  });

  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many requests. Please try again later.'
    }
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many authentication attempts. Please try again later.'
    }
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/auth/resend-verification', authLimiter);
app.use('/api/auth/verify-email', authLimiter);

app.get('/', (req, res) => {
  const frontendBaseUrl = getLocalFrontendBaseUrl();

  if (prefersHtml(req)) {
    res.redirect(302, frontendBaseUrl);
    return;
  }

  res.json({
    status: 'ok',
    service: 'hubspot-audit-tool',
    frontend: frontendBaseUrl,
    api: {
      health: '/health',
      runAudit: 'POST /api/audit/run',
      getAudit: 'GET /api/audit/:id'
    }
  });
});

app.use('/health', healthRoutes);
app.use('/api/auth', authApiRoutes);
app.use('/api/hubspot', hubspotApiRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/auth/hubspot', authRoutes);
app.use('/audit', auditRoutes);
app.use('/api/audit', apiAuditRoutes);
app.use('/api/audits', apiAuditRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
