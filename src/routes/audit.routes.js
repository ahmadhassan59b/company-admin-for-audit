const express = require('express');
const { asyncHandler } = require('../utils/errors');
const auditController = require('../controllers/audit.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

function getLocalFrontendBaseUrl() {
  return (process.env.FRONTEND_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
}

function prefersHtml(req) {
  return req.accepts(['html', 'json']) === 'html';
}

router.get('/run', (req, res) => {
  res.status(405).json({
    error: {
      code: 'method_not_allowed',
      message: 'Use POST /audit/run to run the legacy audit endpoint.'
    }
  });
});
router.post('/run', requireAuth, asyncHandler(auditController.runAudit));

router.get('/:id(\\d+)', (req, res) => {
  if (prefersHtml(req)) {
    res.redirect(302, `${getLocalFrontendBaseUrl()}/audit/${req.params.id}`);
    return;
  }

  res.status(404).json({
    error: {
      code: 'route_not_available',
      message: 'The audit viewer is served by the UI server. Use GET /api/audit/:id for JSON.'
    }
  });
});

module.exports = router;
