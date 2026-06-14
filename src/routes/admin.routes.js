const express = require('express');
const adminController = require('../controllers/admin.controller');
const { asyncHandler } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

function isLocalDashboardPreview(req) {
  if (String(process.env.ADMIN_DASHBOARD_REQUIRE_AUTH || '').toLowerCase() === 'true') {
    return false;
  }

  if (String(process.env.NODE_ENV || 'development').toLowerCase() === 'production') {
    return false;
  }

  const host = String(req.headers.host || '').toLowerCase();
  const ip = String(req.ip || req.socket?.remoteAddress || '');
  return (
    host.startsWith('localhost:') ||
    host.startsWith('127.0.0.1:') ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1'
  );
}

function requireAdminOrLocalPreview(req, res, next) {
  if (isLocalDashboardPreview(req)) {
    next();
    return;
  }

  requireAuth(req, res, (authError) => {
    if (authError) {
      next(authError);
      return;
    }

    requireRole('admin')(req, res, next);
  });
}

router.get('/dashboard', requireAdminOrLocalPreview, asyncHandler(adminController.getDashboard));

module.exports = router;
