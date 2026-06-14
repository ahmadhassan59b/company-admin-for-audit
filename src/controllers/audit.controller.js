const env = require('../config/env');
const auditService = require('../services/audit/audit.service');
const securityService = require('../services/security/security.service');
const { buildCsvExport, buildPdfBuffer } = require('../services/audit/export.service');

function setPrivateCache(res, maxAgeSeconds = 30) {
  res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=120`);
  res.setHeader('Vary', 'Authorization');
}

async function runAudit(req, res) {
  const accountKey = req.body.accountKey || env.internalAccountKey;
  const audit = await auditService.runHubSpotAudit(accountKey);

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'legacy_audit_run',
    severity: 'info',
    details: {
      accountKey: String(accountKey || '')
    }
  }).catch(() => {});

  res.json({
    data: audit
  });
}

async function runPhase1Audit(req, res) {
  const accountKey = req.tenantId || req.body.accountKey || env.internalAccountKey;
  const aiPromptMode = req.query.mode || req.query.promptMode || req.body.promptMode || req.body.aiPromptMode;
  const scope = req.body.scope || req.query.scope || null;

  const includeAi =
    req.query.ai === '1' ||
    req.query.ai === 'true' ||
    req.body.includeAi === true ||
    req.body.includeAi === 'true';

  const audit = await auditService.runPhase1Audit(accountKey, { includeAi, aiPromptMode, scope });

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'audit_run_completed',
    severity: 'info',
    details: {
      accountKey: String(accountKey || ''),
      includeAi: Boolean(includeAi),
      aiPromptMode: aiPromptMode || null,
      scope: scope || null
    }
  }).catch(() => {});

  res.status(201).json({
    data: audit
  });
}

async function getPhase1Report(req, res) {
  const audit = await auditService.getPhase1Report(req.params.id, req.tenantId);
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function getPhase1ReportSummary(req, res) {
  const audit = await auditService.getPhase1ReportSummary(req.params.id, req.tenantId);
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function getPhase1ReportObject(req, res) {
  const audit = await auditService.getPhase1ReportObject(
    req.params.id,
    req.params.objectType,
    req.tenantId
  );
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function getPhase1ReportDetailSection(req, res) {
  const audit = await auditService.getPhase1ReportDetailSection(
    req.params.id,
    req.params.section,
    req.tenantId
  );
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function getLatestPhase1ReportObjectByPortal(req, res) {
  const audit = await auditService.getLatestPhase1ReportObjectByPortalId(
    req.params.portalId,
    req.params.objectType,
    req.tenantId
  );
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function getLatestPhase1ReportByPortal(req, res) {
  const audit = await auditService.getLatestPhase1ReportByPortalId(
    req.params.portalId,
    req.tenantId
  );
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function getLatestPhase1ReportSummaryByPortal(req, res) {
  const audit = await auditService.getLatestPhase1ReportSummaryByPortalId(
    req.params.portalId,
    req.tenantId
  );
  setPrivateCache(res, 30);

  res.json({
    data: audit
  });
}

async function listPhase1Reports(req, res) {
  const summaryOnly = req.query.summary === '1' || req.query.summary === 'true';
  const audits = await auditService.listPhase1Reports(req.tenantId, { summaryOnly });
  setPrivateCache(res, 15);

  res.json({
    data: {
      audits
    }
  });
}

async function generateAiForReport(req, res) {
  const auditId = req.params.id;
  const aiPromptMode = req.query.mode || req.query.promptMode || req.body.promptMode || req.body.aiPromptMode;
  const aiObjectType = req.query.objectType || req.body.objectType || req.body.aiObjectType || null;
  const aiObjectLabel = req.query.objectLabel || req.body.objectLabel || req.body.aiObjectLabel || null;
  const result = await auditService.generateAiForReport(auditId, req.tenantId, {
    aiPromptMode,
    aiObjectType,
    aiObjectLabel
  });

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'audit_ai_regenerated',
    severity: 'info',
    details: {
      auditId: String(auditId || ''),
      aiPromptMode: aiPromptMode || null,
      aiObjectType: aiObjectType || null
    }
  }).catch(() => {});

  const statusCode = result && (result.queued || result.ai_status === 'running' || result.ai_status === 'queued') ? 202 : 200;

  res.status(statusCode).json({
    data: result
  });
}

async function exportAuditCsv(req, res) {
  const audit = await auditService.getPhase1Report(req.params.id, req.tenantId);
  const csv = buildCsvExport(audit);
  const filename = `hubspot-audit-${req.params.id}.csv`;

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'audit_export_csv',
    severity: 'info',
    details: {
      auditId: String(req.params.id || '')
    }
  }).catch(() => {});

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

async function exportAuditPdf(req, res) {
  const audit = await auditService.getPhase1Report(req.params.id, req.tenantId);
  const pdf = await buildPdfBuffer(audit);
  const filename = `hubspot-audit-${req.params.id}.pdf`;

  await securityService.logSecurityEvent({
    userId: req.user && req.user.id ? req.user.id : null,
    tenantId: req.tenantId || null,
    eventType: 'audit_export_pdf',
    severity: 'info',
    details: {
      auditId: String(req.params.id || '')
    }
  }).catch(() => {});

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
}

module.exports = {
  runAudit,
  runPhase1Audit,
  getPhase1Report,
  getPhase1ReportSummary,
  getPhase1ReportObject,
  getPhase1ReportDetailSection,
  getLatestPhase1ReportByPortal,
  getLatestPhase1ReportSummaryByPortal,
  getLatestPhase1ReportObjectByPortal,
  listPhase1Reports,
  generateAiForReport,
  exportAuditCsv,
  exportAuditPdf
};
