const express = require('express');
const { asyncHandler } = require('../utils/errors');
const auditController = require('../controllers/audit.controller');
const { optionalAuth } = require('../middleware/auth.middleware');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(optionalAuth);
router.get('/', requireAuth, asyncHandler(auditController.listPhase1Reports));
router.get('/run', (req, res) => {
  res.status(405).json({
    error: {
      code: 'method_not_allowed',
      message: 'Use POST /api/audit/run to start a new audit.'
    }
  });
});
router.post('/run', requireAuth, asyncHandler(auditController.runPhase1Audit));
router.get('/:id(\\d+)/summary', requireAuth, asyncHandler(auditController.getPhase1ReportSummary));
router.get('/:id(\\d+)/object/:objectType', requireAuth, asyncHandler(auditController.getPhase1ReportObject));
router.get('/:id(\\d+)/details/:section', requireAuth, asyncHandler(auditController.getPhase1ReportDetailSection));
router.get('/portal/:portalId/latest', requireAuth, asyncHandler(auditController.getLatestPhase1ReportByPortal));
router.get(
  '/portal/:portalId/latest/summary',
  requireAuth,
  asyncHandler(auditController.getLatestPhase1ReportSummaryByPortal)
);
router.get(
  '/portal/:portalId/latest/object/:objectType',
  requireAuth,
  asyncHandler(auditController.getLatestPhase1ReportObjectByPortal)
);
router.get('/:id(\\d+)/export/csv', requireAuth, asyncHandler(auditController.exportAuditCsv));
router.get('/:id(\\d+)/export/pdf', requireAuth, asyncHandler(auditController.exportAuditPdf));
router.get('/:id(\\d+)', requireAuth, asyncHandler(auditController.getPhase1Report));
router.post('/:id(\\d+)/ai', requireAuth, asyncHandler(auditController.generateAiForReport));

module.exports = router;
