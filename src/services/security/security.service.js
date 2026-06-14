const db = require('../../config/db');
const { AppError } = require('../../utils/errors');
const { encryptString, decryptString } = require('./crypto.service');
const { randomBase32Secret, buildOtpauthUri, verifyTotp } = require('./totp.service');

let securitySchemaReady = null;

async function ensureSecuritySchema() {
  if (!securitySchemaReady) {
    securitySchemaReady = (async () => {
      await db.query(
        `
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
            ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS two_factor_secret_enc TEXT,
            ADD COLUMN IF NOT EXISTS two_factor_verified_at TIMESTAMPTZ
        `
      );

      await db.query(
        `
          CREATE TABLE IF NOT EXISTS security_events (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
            event_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `
      );
    })().catch((error) => {
      securitySchemaReady = null;
      throw error;
    });
  }

  return securitySchemaReady;
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' ? 'admin' : 'user';
}

async function logSecurityEvent({
  userId = null,
  tenantId = null,
  eventType,
  severity = 'info',
  details = {}
}) {
  if (!eventType) return null;
  await ensureSecuritySchema();

  const result = await db.query(
    `
      INSERT INTO security_events (
        user_id,
        tenant_id,
        event_type,
        severity,
        details,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `,
    [userId, tenantId, eventType, severity, details || {}]
  );

  return result.rows[0];
}

async function listSecurityEvents({ tenantId = null, limit = 100 } = {}) {
  await ensureSecuritySchema();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const params = [];
  const where = [];

  if (tenantId) {
    params.push(tenantId);
    where.push(`tenant_id = $${params.length}`);
  }

  params.push(safeLimit);

  const result = await db.query(
    `
      SELECT id, user_id, tenant_id, event_type, severity, details, created_at
      FROM security_events
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function getSecurityUsers() {
  await ensureSecuritySchema();
  const result = await db.query(
    `
      SELECT *
      FROM users
      ORDER BY created_at DESC
    `
  );

  return result.rows;
}

async function updateUserRole(userId, role) {
  await ensureSecuritySchema();
  const safeRole = normalizeRole(role);
  const result = await db.query(
    `
      UPDATE users
      SET role = $2
      WHERE id = $1
      RETURNING id, email, tenant_id, role, two_factor_enabled, created_at
    `,
    [userId, safeRole]
  );

  if (result.rowCount === 0) {
    throw new AppError('User not found', 404, 'user_not_found');
  }

  return result.rows[0];
}

async function getUserSecurityState(userId) {
  await ensureSecuritySchema();
  const result = await db.query(
    `
      SELECT *
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function setupTwoFactor(userId) {
  await ensureSecuritySchema();
  const user = await getUserSecurityState(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'user_not_found');
  }

  if (user.two_factor_enabled) {
    throw new AppError('Two-factor authentication is already enabled', 409, 'two_factor_already_enabled');
  }

  const secret = randomBase32Secret();
  const encryptedSecret = encryptString(secret);

  await db.query(
    `
      UPDATE users
      SET two_factor_secret_enc = $2,
          two_factor_enabled = FALSE,
          two_factor_verified_at = NULL
      WHERE id = $1
    `,
    [userId, encryptedSecret]
  );

  const accountLabel = user.email || `user-${userId}`;
  return {
    secret,
    otpauth_uri: buildOtpauthUri({
      secret,
      accountLabel,
      issuer: 'HubAudit'
    })
  };
}

async function enableTwoFactor(userId, code) {
  await ensureSecuritySchema();
  const user = await getUserSecurityState(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'user_not_found');
  }

  const secret = decryptString(user.two_factor_secret_enc);
  if (!secret) {
    throw new AppError('Two-factor authentication is not set up', 400, 'two_factor_not_setup');
  }

  if (!verifyTotp(secret, code)) {
    throw new AppError('Invalid two-factor code', 401, 'invalid_two_factor_code');
  }

  await db.query(
    `
      UPDATE users
      SET two_factor_enabled = TRUE,
          two_factor_verified_at = NOW()
      WHERE id = $1
    `,
    [userId]
  );

  return getUserSecurityState(userId);
}

async function disableTwoFactor(userId) {
  await ensureSecuritySchema();
  const result = await db.query(
    `
      UPDATE users
      SET two_factor_enabled = FALSE,
          two_factor_secret_enc = NULL,
          two_factor_verified_at = NULL
      WHERE id = $1
      RETURNING id, email, tenant_id, role, two_factor_enabled, created_at
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new AppError('User not found', 404, 'user_not_found');
  }

  return result.rows[0];
}

function verifyTwoFactorCode(user, code) {
  if (!user || !user.two_factor_enabled) return true;
  const secret = decryptString(user.two_factor_secret_enc);
  if (!secret) return false;
  return verifyTotp(secret, code);
}

module.exports = {
  logSecurityEvent,
  listSecurityEvents,
  getSecurityUsers,
  updateUserRole,
  getUserSecurityState,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  verifyTwoFactorCode
};
