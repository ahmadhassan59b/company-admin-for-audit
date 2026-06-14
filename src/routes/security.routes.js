const express = require('express');
const securityController = require('../controllers/security.controller');
const { asyncHandler } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.get('/events', requireAuth, requireRole('admin'), asyncHandler(securityController.listEvents));
router.get('/users', requireAuth, requireRole('admin'), asyncHandler(securityController.listUsers));
router.patch('/users/:id/role', requireAuth, requireRole('admin'), asyncHandler(securityController.updateUserRole));

router.get('/2fa/status', requireAuth, asyncHandler(securityController.getTwoFactorStatus));
router.post('/2fa/setup', requireAuth, asyncHandler(securityController.setupTwoFactor));
router.post('/2fa/enable', requireAuth, asyncHandler(securityController.enableTwoFactor));
router.post('/2fa/disable', requireAuth, asyncHandler(securityController.disableTwoFactor));

module.exports = router;
