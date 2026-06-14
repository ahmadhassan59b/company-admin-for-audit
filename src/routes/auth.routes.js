const express = require('express');
const { asyncHandler } = require('../utils/errors');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.get('/', asyncHandler(authController.redirectToHubSpot));
router.get('/callback', asyncHandler(authController.handleCallback));

module.exports = router;
