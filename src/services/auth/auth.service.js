const axios = require('axios');
const crypto = require('crypto');
const db = require('../../config/db');
const env = require('../../config/env');
const { AppError } = require('../../utils/errors');
const passwordService = require('./password.service');
const tokenService = require('./token.service');
const emailService = require('./email.service');
const securityService = require('../security/security.service');

let authSchemaReady = null;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    tenantId: user.tenant_id,
    role: user.role || 'user',
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    emailVerifiedAt: user.email_verified_at || null,
    createdAt: user.created_at
  };
}

function createVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getVerificationExpiry() {
  const ttlMinutes = Math.max(5, Number(env.emailVerificationTokenTtlMinutes) || 60);
  return new Date(Date.now() + ttlMinutes * 60 * 1000);
}

function getGoogleClientId() {
  return env.googleClientId || '';
}

function buildWorkspaceNameFromProfile(email, profileName) {
  const trimmedName = String(profileName || '').trim();
  if (trimmedName) {
    return trimmedName;
  }

  const localPart = String(email || '')
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim();

  if (!localPart) {
    return 'Google Workspace';
  }

  return `${localPart.charAt(0).toUpperCase()}${localPart.slice(1)} workspace`;
}

async function verifyGoogleIdToken(credential) {
  if (!env.googleClientId) {
    throw new AppError('Google sign-in is not configured', 503, 'google_signin_not_configured');
  }

  const token = String(credential || '').trim();
  if (!token) {
    throw new AppError('Missing Google credential', 400, 'missing_google_credential');
  }

  try {
    const response = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
      params: {
        id_token: token
      },
      timeout: 10000
    });

    const profile = response.data || {};
    const audience = String(profile.aud || '').trim();
    const issuer = String(profile.iss || '').trim();
    const emailVerified = String(profile.email_verified || '').toLowerCase() === 'true';

    if (
      audience !== env.googleClientId ||
      !profile.email ||
      !emailVerified ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(issuer)
    ) {
      throw new AppError('Google credential is invalid or expired', 401, 'invalid_google_credential');
    }

    return profile;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const providerMessage = String(
      error.response?.data?.error_description || error.response?.data?.error || error.message || 'unknown error'
    ).trim();

    throw new AppError(
      `Google sign-in failed: ${providerMessage}`,
      401,
      'invalid_google_credential'
    );
  }
}

async function cleanupFailedSignup(userId, tenantId) {
  if (userId) {
    await db.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  }

  if (tenantId) {
    await db.query(
      `
        DELETE FROM tenants
        WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = $1)
          AND NOT EXISTS (SELECT 1 FROM hubspot_accounts WHERE tenant_id = $1)
          AND NOT EXISTS (SELECT 1 FROM migration_client_keys WHERE tenant_id = $1)
      `,
      [tenantId]
    ).catch(() => {});
  }
}

async function ensureAuthSchema() {
  if (!authSchemaReady) {
    authSchemaReady = (async () => {
      await db.query(
        `
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
            ADD COLUMN IF NOT EXISTS email_verification_token_expires_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ
        `
      );

      await db.query(
        `
          CREATE INDEX IF NOT EXISTS idx_users_email_verification_token_hash
            ON users (email_verification_token_hash)
        `
      );

      await db.query(
        `
          CREATE INDEX IF NOT EXISTS idx_users_email_verified_at
            ON users (email_verified_at)
        `
      );
    })().catch((error) => {
      authSchemaReady = null;
      throw error;
    });
  }

  return authSchemaReady;
}

async function register({ email, password, tenantName, clientKey }) {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password || password.length < 8) {
    throw new AppError('Email and password with at least 8 characters are required', 400, 'invalid_signup');
  }

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [
    normalizedEmail
  ]);

  if (existing.rowCount > 0) {
    throw new AppError('User already exists', 409, 'user_exists');
  }

  emailService.ensureEmailDeliveryConfigured();

  const tenantResult = await db.query(
    'INSERT INTO tenants (name) VALUES ($1) RETURNING *',
    [tenantName || `${normalizedEmail} tenant`]
  );
  const tenant = tenantResult.rows[0];
  const verificationToken = createVerificationToken();
  const verificationTokenHash = hashVerificationToken(verificationToken);
  const verificationExpiresAt = getVerificationExpiry();

  const userResult = await db.query(
    `
      INSERT INTO users (
        email,
        password_hash,
        tenant_id,
        email_verification_token_hash,
        email_verification_token_expires_at,
        email_verification_sent_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `,
    [
      normalizedEmail,
      passwordService.hashPassword(password),
      tenant.id,
      verificationTokenHash,
      verificationExpiresAt
    ]
  );
  const user = userResult.rows[0];
  await migrateClientKeyToTenant(clientKey, tenant.id);

  let emailDelivery;
  try {
    emailDelivery = await emailService.sendVerificationEmail({
      to: normalizedEmail,
      tenantName: tenant.name,
      token: verificationToken
    });
  } catch (error) {
    await cleanupFailedSignup(user.id, tenant.id);
    throw error;
  }

  await securityService.logSecurityEvent({
    userId: user.id,
    tenantId: tenant.id,
    eventType: 'verification_email_sent',
    severity: 'info',
    details: { email: normalizedEmail, delivery: emailDelivery.delivery }
  }).catch(() => {});

  await securityService.logSecurityEvent({
    userId: user.id,
    tenantId: tenant.id,
    eventType: 'user_registered',
    severity: 'info',
    details: { email: normalizedEmail }
  }).catch(() => {});

  return {
    user: publicUser(user),
    tenant,
    verificationRequired: true,
    verificationEmailSent: Boolean(emailDelivery)
  };
}

async function googleSignIn({ credential }) {
  await ensureAuthSchema();
  const profile = await verifyGoogleIdToken(credential);
  const normalizedEmail = normalizeEmail(profile.email);

  const existing = await db.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [
    normalizedEmail
  ]);

  let user;
  let tenant;

  if (existing.rowCount > 0) {
    const updatedResult = await db.query(
      `
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, NOW())
        WHERE id = $1
        RETURNING *
      `,
      [existing.rows[0].id]
    );
    user = updatedResult.rows[0];
    tenant = await db.query('SELECT * FROM tenants WHERE id = $1 LIMIT 1', [user.tenant_id]).then((result) => result.rows[0] || null);
  } else {
    const tenantResult = await db.query(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING *',
      [buildWorkspaceNameFromProfile(normalizedEmail, profile.name)]
    );
    tenant = tenantResult.rows[0];

    const userResult = await db.query(
      `
        INSERT INTO users (
          email,
          password_hash,
          tenant_id,
          email_verified_at
        )
        VALUES ($1, NULL, $2, NOW())
        RETURNING *
      `,
      [normalizedEmail, tenant.id]
    );
    user = userResult.rows[0];
  }

  await securityService.logSecurityEvent({
    userId: user.id,
    tenantId: user.tenant_id,
    eventType: existing.rowCount > 0 ? 'google_signin_success' : 'google_account_created',
    severity: 'info',
    details: { email: normalizedEmail, provider: 'google' }
  }).catch(() => {});

  return {
    token: tokenService.issueToken(user),
    user: publicUser(user),
    tenant,
    provider: 'google'
  };
}

async function migrateClientKeyToTenant(clientKey, tenantId) {
  if (!clientKey) return null;

  const existingMapping = await db.query(
    'SELECT tenant_id FROM migration_client_keys WHERE client_key = $1',
    [clientKey]
  );

  if (existingMapping.rowCount > 0) {
    return existingMapping.rows[0].tenant_id;
  }

  const connectionResult = await db.query(
    'SELECT * FROM hubspot_connections WHERE internal_account_key = $1',
    [clientKey]
  );

  if (connectionResult.rowCount === 0) {
    return null;
  }

  const connection = connectionResult.rows[0];

  await db.query(
    `
      INSERT INTO hubspot_connections (
        internal_account_key,
        hubspot_portal_id,
        access_token,
        refresh_token,
        token_expires_at,
        token_type,
        scopes,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (internal_account_key)
      DO UPDATE SET
        hubspot_portal_id = EXCLUDED.hubspot_portal_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        token_type = EXCLUDED.token_type,
        scopes = EXCLUDED.scopes,
        updated_at = NOW()
    `,
    [
      tenantId,
      connection.hubspot_portal_id,
      connection.access_token,
      connection.refresh_token,
      connection.token_expires_at,
      connection.token_type,
      connection.scopes
    ]
  );

  await db.query(
    `
      INSERT INTO hubspot_accounts (
        tenant_id,
        hubspot_account_id,
        access_token,
        refresh_token,
        connected_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (tenant_id, hubspot_account_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        updated_at = NOW()
    `,
    [
      tenantId,
      connection.hubspot_portal_id ? String(connection.hubspot_portal_id) : null,
      connection.access_token,
      connection.refresh_token
    ]
  );

  await db.query(
    `
      INSERT INTO migration_client_keys (client_key, tenant_id)
      VALUES ($1, $2)
      ON CONFLICT (client_key)
      DO UPDATE SET tenant_id = EXCLUDED.tenant_id
    `,
    [clientKey, tenantId]
  );

  return tenantId;
}

async function login({ email, password, twoFactorCode }) {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new AppError('Email and password are required', 400, 'invalid_credentials');
  }

  const result = await db.query('SELECT * FROM users WHERE email = $1', [
    normalizedEmail
  ]);

  if (
    result.rowCount === 0 ||
    !passwordService.verifyPassword(password, result.rows[0].password_hash)
  ) {
    await securityService.logSecurityEvent({
      eventType: 'login_failed',
      severity: 'warning',
      details: { email: normalizedEmail }
    }).catch(() => {});
    throw new AppError('Invalid email or password', 401, 'invalid_credentials');
  }

  const user = result.rows[0];

  if (!user.email_verified_at) {
    await securityService.logSecurityEvent({
      userId: user.id,
      tenantId: user.tenant_id,
      eventType: 'login_blocked_unverified_email',
      severity: 'warning',
      details: { email: normalizedEmail }
    }).catch(() => {});
    throw new AppError('Please verify your email address before logging in', 403, 'email_not_verified');
  }

  if (user.two_factor_enabled) {
    const code = String(twoFactorCode || '').trim();
    if (!code) {
      await securityService.logSecurityEvent({
        userId: user.id,
        tenantId: user.tenant_id,
        eventType: 'two_factor_required',
        severity: 'warning'
      }).catch(() => {});
      throw new AppError('Two-factor authentication code required', 401, 'two_factor_required');
    }

    const verified = securityService.verifyTwoFactorCode(user, code);
    if (!verified) {
      await securityService.logSecurityEvent({
        userId: user.id,
        tenantId: user.tenant_id,
        eventType: 'two_factor_failed',
        severity: 'warning'
      }).catch(() => {});
      throw new AppError('Invalid two-factor code', 401, 'invalid_two_factor_code');
    }
  }

  await securityService.logSecurityEvent({
    userId: user.id,
    tenantId: user.tenant_id,
    eventType: 'login_success',
    severity: 'info'
  }).catch(() => {});

  return {
    token: tokenService.issueToken(user),
    user: publicUser(user)
  };
}

async function resendVerification({ email }) {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new AppError('Email is required', 400, 'invalid_email');
  }

  const result = await db.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [
    normalizedEmail
  ]);

  if (result.rowCount === 0) {
    return {
      verificationRequired: true,
      verificationEmailSent: true
    };
  }

  const user = result.rows[0];

  if (user.email_verified_at) {
    return {
      verificationRequired: false,
      verificationEmailSent: true
    };
  }

  emailService.ensureEmailDeliveryConfigured();

  const verificationToken = createVerificationToken();
  const verificationTokenHash = hashVerificationToken(verificationToken);
  const verificationExpiresAt = getVerificationExpiry();

  await db.query(
    `
      UPDATE users
      SET email_verification_token_hash = $2,
          email_verification_token_expires_at = $3,
          email_verification_sent_at = NOW()
      WHERE id = $1
    `,
    [user.id, verificationTokenHash, verificationExpiresAt]
  );

  const emailDelivery = await emailService.sendVerificationEmail({
    to: normalizedEmail,
    tenantName: null,
    token: verificationToken
  });

  await securityService.logSecurityEvent({
    userId: user.id,
    tenantId: user.tenant_id,
    eventType: 'verification_email_resent',
    severity: 'info',
    details: { email: normalizedEmail, delivery: emailDelivery.delivery }
  }).catch(() => {});

  return {
    verificationRequired: true,
    verificationEmailSent: Boolean(emailDelivery)
  };
}

async function verifyEmail(token) {
  await ensureAuthSchema();
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    throw new AppError('Missing verification token', 400, 'missing_verification_token');
  }

  const tokenHash = hashVerificationToken(normalizedToken);
  const result = await db.query(
    `
      SELECT *
      FROM users
      WHERE email_verification_token_hash = $1
        AND email_verification_token_expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    throw new AppError('Verification link is invalid or expired', 400, 'invalid_verification_token');
  }

  const user = result.rows[0];
  const updatedResult = await db.query(
    `
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, NOW()),
          email_verification_token_hash = NULL,
          email_verification_token_expires_at = NULL,
          email_verification_sent_at = NULL
      WHERE id = $1
      RETURNING *
    `,
    [user.id]
  );
  const updatedUser = updatedResult.rows[0];

  await securityService.logSecurityEvent({
    userId: updatedUser.id,
    tenantId: updatedUser.tenant_id,
    eventType: 'email_verified',
    severity: 'info',
    details: { email: updatedUser.email }
  }).catch(() => {});

  return {
    user: publicUser(updatedUser)
  };
}

async function getUserById(userId) {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

  return result.rows[0] || null;
}

module.exports = {
  register,
  login,
  getGoogleClientId,
  googleSignIn,
  resendVerification,
  verifyEmail,
  getUserById,
  publicUser,
  migrateClientKeyToTenant
};
