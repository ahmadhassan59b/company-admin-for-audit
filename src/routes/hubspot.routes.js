const express = require('express');
const hubspotController = require('../controllers/hubspot.controller');
const { asyncHandler } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/connect-url', requireAuth, asyncHandler(hubspotController.getConnectUrl));
router.get('/accounts', requireAuth, asyncHandler(hubspotController.listAccounts));
router.post('/switch', requireAuth, asyncHandler(hubspotController.switchAccount));
router.post('/accounts/:portalId/label', requireAuth, asyncHandler(hubspotController.setAccountLabel));
router.delete('/accounts/:portalId', requireAuth, asyncHandler(hubspotController.deleteAccount));

module.exports = router;
