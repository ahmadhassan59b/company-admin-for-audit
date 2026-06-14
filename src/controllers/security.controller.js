const securityService = require('../services/security/security.service');

async function listEvents(req, res) {
  const events = await securityService.listSecurityEvents({
    tenantId: req.tenantId || null,
    limit: req.query.limit || 100
  });

  res.json({
    data: {
      events
    }
  });
}

async function listUsers(req, res) {
  const users = await securityService.getSecurityUsers();

  res.json({
    data: {
      users
    }
  });
}

async function updateUserRole(req, res) {
  const { role } = req.body || {};
  const updated = await securityService.updateUserRole(req.params.id, role);

  await securityService.logSecurityEvent({
    userId: req.user.id,
    tenantId: req.tenantId || null,
    eventType: 'user_role_updated',
    severity: 'info',
    details: {
      targetUserId: req.params.id,
      role: updated.role
    }
  }).catch(() => {});

  res.json({
    data: updated
  });
}

async function getTwoFactorStatus(req, res) {
  const user = await securityService.getUserSecurityState(req.user.id);

  res.json({
    data: {
      enabled: Boolean(user && user.two_factor_enabled),
      verifiedAt: user ? user.two_factor_verified_at : null
    }
  });
}

async function setupTwoFactor(req, res) {
  const result = await securityService.setupTwoFactor(req.user.id);

  await securityService.logSecurityEvent({
    userId: req.user.id,
    tenantId: req.tenantId || null,
    eventType: 'two_factor_setup_started',
    severity: 'info'
  }).catch(() => {});

  res.json({
    data: result
  });
}

async function enableTwoFactor(req, res) {
  const { code } = req.body || {};
  const user = await securityService.enableTwoFactor(req.user.id, code);

  await securityService.logSecurityEvent({
    userId: req.user.id,
    tenantId: req.tenantId || null,
    eventType: 'two_factor_enabled',
    severity: 'info'
  }).catch(() => {});

  res.json({
    data: {
      enabled: Boolean(user && user.two_factor_enabled)
    }
  });
}

async function disableTwoFactor(req, res) {
  const user = await securityService.disableTwoFactor(req.user.id);

  await securityService.logSecurityEvent({
    userId: req.user.id,
    tenantId: req.tenantId || null,
    eventType: 'two_factor_disabled',
    severity: 'warning'
  }).catch(() => {});

  res.json({
    data: {
      enabled: Boolean(user && user.two_factor_enabled)
    }
  });
}

module.exports = {
  listEvents,
  listUsers,
  updateUserRole,
  getTwoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor
};
