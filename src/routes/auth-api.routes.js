const express = require('express');
const authApiController = require('../controllers/auth-api.controller');
const { asyncHandler } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', asyncHandler(authApiController.register));
router.post('/login', asyncHandler(authApiController.login));
router.get('/google-config', asyncHandler(authApiController.googleConfig));
router.post('/google', asyncHandler(authApiController.googleSignIn));
router.post('/resend-verification', asyncHandler(authApiController.resendVerification));
router.get('/verify-email', asyncHandler(authApiController.verifyEmail));
router.get('/me', requireAuth, asyncHandler(authApiController.me));

module.exports = router;
