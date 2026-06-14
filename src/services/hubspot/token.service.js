const crypto = require('crypto');
const db = require('../../config/db');
const env = require('../../config/env');
const oauthService = require('./oauth.service');
const { AppError } = require('../../utils/errors');

const REFRESH_WINDOW_MS = 5 * 60 * 1000;

function getKey() {
  return crypto.createHash('sha256').update(env.tokenEncryptionKey).digest();
}

function encryptToken(value) {
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptToken(value) {
  if (!value || !value.startsWith('enc:v1:')) return value;

  const [, , ivValue, tagValue, encryptedValue] = value.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivValue, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function expiresAtFromNow(expiresInSeconds) {
  return new Date(Date.now() + Number(expiresInSeconds || 0) * 1000);
}

function normalizeScopesValue(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const normalized = value
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean);

      if (normalized.length > 0) {
        return normalized.join(' ');
      }
    } else if (typeof value === 'string') {
      const normalized = String(value || '')
        .trim()
        .toLowerCase();

      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

async function upsertConnection(accountKey, tokenPayload, metadata = {}) {
  const expiresAt = expiresAtFromNow(tokenPayload.expires_in);
  const hubspotPortalId = metadata.hub_id || metadata.hubId || null;
  const hubspotUserId = metadata.user_id || metadata.userId || metadata.signed_access_token?.userId || null;
  const scopes = normalizeScopesValue(
    tokenPayload.scope,
    tokenPayload.scopes,
    metadata.scopes,
    metadata.scope
  );

  try {
    const result = await db.query(
      `
        INSERT INTO hubspot_connections (
          internal_account_key,
          hubspot_portal_id,
          hubspot_user_id,
          access_token,
          refresh_token,
          token_expires_at,
          token_type,
          scopes,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (internal_account_key)
        DO UPDATE SET
          hubspot_portal_id = EXCLUDED.hubspot_portal_id,
          hubspot_user_id = COALESCE(EXCLUDED.hubspot_user_id, hubspot_connections.hubspot_user_id),
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          token_type = EXCLUDED.token_type,
          scopes = EXCLUDED.scopes,
          updated_at = NOW()
        RETURNING *
      `,
      [
        accountKey,
        hubspotPortalId,
        hubspotUserId,
        encryptToken(tokenPayload.access_token),
        encryptToken(tokenPayload.refresh_token),
        expiresAt,
        tokenPayload.token_type || 'bearer',
        scopes
      ]
    );

    return result.rows[0];
  } catch (error) {
    const isUndefinedColumn =
      error && (error.code === '42703' || /column .* does not exist/i.test(String(error.message || '')));

    if (!isUndefinedColumn) {
      throw error;
    }

    const legacyResult = await db.query(
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
        RETURNING *
      `,
      [
        accountKey,
        hubspotPortalId,
        encryptToken(tokenPayload.access_token),
        encryptToken(tokenPayload.refresh_token),
        expiresAt,
        tokenPayload.token_type || 'bearer',
        scopes
      ]
    );

    return legacyResult.rows[0];
  }
}

async function getConnection(accountKey) {
  const result = await db.query(
    'SELECT * FROM hubspot_connections WHERE internal_account_key = $1',
    [accountKey]
  );

  return result.rows[0] || null;
}

async function clearConnection(accountKey) {
  await db.query('DELETE FROM hubspot_connections WHERE internal_account_key = $1', [accountKey]);
}

async function getValidAccessToken(accountKey, options = {}) {
  const connection = await getConnection(accountKey);

  if (!connection) {
    throw new AppError('HubSpot account is not connected', 404, 'hubspot_not_connected');
  }

  const expiresAt = new Date(connection.token_expires_at).getTime();
  const shouldRefresh =
    Boolean(options.forceRefresh) ||
    !expiresAt ||
    expiresAt - Date.now() <= REFRESH_WINDOW_MS;

  if (!shouldRefresh) {
    return decryptToken(connection.access_token);
  }

  const refreshToken = decryptToken(connection.refresh_token);
  const refreshed = await oauthService.refreshAccessToken(refreshToken);

  const updatedConnection = await upsertConnection(
    accountKey,
    {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || refreshToken,
      expires_in: refreshed.expires_in,
      token_type: refreshed.token_type,
      scope: refreshed.scope,
      scopes: refreshed.scopes
    },
    {
      hub_id: connection.hubspot_portal_id,
      scopes: refreshed.scopes || connection.scopes
    }
  );

  // Keep multi-portal storage in sync for tenant-based installs so switching portals stays reliable.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(accountKey)
    ) &&
    updatedConnection &&
    updatedConnection.hubspot_portal_id
  ) {
    await db.query(
      `
        UPDATE hubspot_accounts
        SET access_token = $3,
            refresh_token = $4,
            updated_at = NOW()
        WHERE tenant_id = $1 AND hubspot_account_id = $2
      `,
      [
        String(accountKey),
        String(updatedConnection.hubspot_portal_id),
        updatedConnection.access_token,
        updatedConnection.refresh_token
      ]
    );
  }

  return refreshed.access_token;
}

module.exports = {
  upsertConnection,
  getConnection,
  getValidAccessToken,
  clearConnection
};
