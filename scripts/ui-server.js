const path = require('path');
const express = require('express');
const compression = require('compression');
const http = require('http');
const https = require('https');
const { getBuildInfo } = require('../src/utils/buildInfo');

const app = express();

const port = Number(process.env.PORT || process.env.UI_PORT || 3001);
const staticRoot = path.join(__dirname, '..', 'ui-static');
const adminRoot = path.join(__dirname, '..', 'ui-admin');
const vendorRoot = path.join(__dirname, '..', 'node_modules');
const backendBaseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3000';

function setAssetCacheHeaders(res, maxAgeSeconds = 300) {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=86400`);
}

app.use(compression());

function proxyToBackend(req, res) {
  const target = new URL(req.originalUrl, backendBaseUrl);
  const headers = { ...req.headers };
  headers.host = target.host;
  const client = target.protocol === 'https:' ? https : http;

  const proxyReq = client.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 502);
      Object.entries(proxyRes.headers || {}).forEach(([key, value]) => {
        if (typeof value !== 'undefined') res.setHeader(key, value);
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', () => {
    res.status(502).json({
      error: {
        code: 'backend_unreachable',
        message: `Backend is not reachable at ${backendBaseUrl}. Start it with: npm start`
      }
    });
  });

  req.pipe(proxyReq);
}

app.get('/health/version', (req, res) => {
  res.json({
    status: 'ok',
    ...getBuildInfo(),
    timestamp: new Date().toISOString()
  });
});

app.get('/favicon.ico', (req, res) => {
  setAssetCacheHeaders(res, 3600);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.sendFile(path.join(staticRoot, 'logo-mark.svg'));
});

app.get('/favicon.svg', (req, res) => {
  setAssetCacheHeaders(res, 3600);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.sendFile(path.join(staticRoot, 'logo-mark.svg'));
});

// Proxy backend API endpoints only. Do not proxy UI routes such as /audit/:id.
app.use(['/api', '/auth', '/health'], proxyToBackend);

// Optional: legacy backend audit runner (kept for parity with the backend).
app.post('/audit/run', proxyToBackend);

// Vendor assets (served locally to avoid CDN dependencies).
app.get('/static/vendor/chart.umd.js', (req, res) => {
  setAssetCacheHeaders(res, 86400);
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(path.join(vendorRoot, 'chart.js', 'dist', 'chart.umd.js'));
});

app.use(
  '/static',
  express.static(staticRoot, {
    fallthrough: true,
    maxAge: '1h',
    etag: true
  })
);

app.use(
  '/admin-static',
  express.static(adminRoot, {
    fallthrough: true,
    maxAge: '1h',
    etag: true
  })
);

function sendPage(res, filename) {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(staticRoot, filename));
}

function sendAdminPage(res) {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(adminRoot, 'index.html'));
}

app.get('/', (req, res) => res.redirect(302, '/admin'));
app.get('/login', (req, res) => sendPage(res, 'login.html'));
app.get('/dashboard', (req, res) => res.redirect(302, '/admin'));
app.get('/dashboard/accounts', (req, res) => res.redirect(302, '/admin/customers'));
app.get('/dashboard/audits', (req, res) => res.redirect(302, '/admin/audits'));
app.get('/dashboard/privacy', (req, res) => res.redirect(302, '/admin/settings'));
app.get('/dashboard/profile', (req, res) => res.redirect(302, '/admin/settings'));
app.get('/dashboard/admin', (req, res) => res.redirect(302, '/admin'));
app.get('/admin', (req, res) => sendAdminPage(res));
app.get('/admin/customers', (req, res) => sendAdminPage(res));
app.get('/admin/packages', (req, res) => sendAdminPage(res));
app.get('/admin/billing', (req, res) => sendAdminPage(res));
app.get('/admin/audits', (req, res) => sendAdminPage(res));
app.get('/admin/settings', (req, res) => sendAdminPage(res));
app.get('/connected', (req, res) => sendPage(res, 'connected.html'));
app.get('/verify-email', (req, res) => sendPage(res, 'verify-email.html'));
app.get('/audit/:id', (req, res) => sendPage(res, 'audit.html'));
app.get(
  '/audit/:id/:reportType(contact-report|company-report|deal-report|email-report|workflow-report|form-report|pipeline-report|property-report|list-report|owner-report|association-report)',
  (req, res) => sendPage(res, 'audit.html')
);

app.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`UI server running on http://0.0.0.0:${port}`);
});
