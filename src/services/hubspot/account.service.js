const db = require('../../config/db');
const tokenService = require('./token.service');
const accountLabelService = require('./account-label.service');
const { AppError } = require('../../utils/errors');

async function upsertHubSpotAccountBase(tenantId, connection) {
  return db.query(
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
      RETURNING *
    `,
    [
      tenantId,
      connection.hubspot_portal_id ? String(connection.hubspot_portal_id) : null,
      connection.access_token,
      connection.refresh_token
    ]
  );
}

async function upsertHubSpotAccountLegacy(tenantId, connection, details = {}) {
  const name = details.companyName || details.company_name || details.name || null;
  const domain = details.hubDomain || details.hub_domain || details.domain || null;
  const displayName = details.display_name || details.displayName || details.brandName || name || domain || null;

  return db.query(
    `
      INSERT INTO hubspot_accounts (
        tenant_id,
        hubspot_account_id,
        access_token,
        refresh_token,
        hubspot_account_name,
        hubspot_account_domain,
        display_name,
        display_name_is_custom,
        connected_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
      ON CONFLICT (tenant_id, hubspot_account_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        hubspot_account_name = COALESCE(EXCLUDED.hubspot_account_name, hubspot_accounts.hubspot_account_name),
        hubspot_account_domain = COALESCE(EXCLUDED.hubspot_account_domain, hubspot_accounts.hubspot_account_domain),
        display_name = CASE
          WHEN hubspot_accounts.display_name_is_custom THEN hubspot_accounts.display_name
          ELSE COALESCE(EXCLUDED.display_name, hubspot_accounts.display_name)
        END,
        display_name_is_custom = hubspot_accounts.display_name_is_custom OR EXCLUDED.display_name_is_custom,
        updated_at = NOW()
      RETURNING *
    `,
    [
      tenantId,
      connection.hubspot_portal_id ? String(connection.hubspot_portal_id) : null,
      connection.access_token,
      connection.refresh_token,
      name,
      domain,
      displayName
    ]
  );
}

async function upsertHubSpotAccountForTenant(tenantId, connection, details = {}) {
  const name = details.companyName || details.company_name || details.name || null;
  const domain = details.hubDomain || details.hub_domain || details.domain || null;
  const timezone = details.timeZone || details.timezone || null;
  const currency = details.currency || null;
  const displayName = details.display_name || details.displayName || details.brandName || name || domain || null;
  try {
    const result = await db.query(
      `
        INSERT INTO hubspot_accounts (
          tenant_id,
          hubspot_account_id,
          access_token,
          refresh_token,
          account_name,
          account_domain,
          account_timezone,
          account_currency,
          hubspot_account_name,
          hubspot_account_domain,
          display_name,
          display_name_is_custom,
          connected_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $6, $9, FALSE, NOW(), NOW())
        ON CONFLICT (tenant_id, hubspot_account_id)
        DO UPDATE SET
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          account_name = COALESCE(EXCLUDED.account_name, hubspot_accounts.account_name),
          account_domain = COALESCE(EXCLUDED.account_domain, hubspot_accounts.account_domain),
          account_timezone = COALESCE(EXCLUDED.account_timezone, hubspot_accounts.account_timezone),
          account_currency = COALESCE(EXCLUDED.account_currency, hubspot_accounts.account_currency),
          hubspot_account_name = COALESCE(EXCLUDED.hubspot_account_name, hubspot_accounts.hubspot_account_name),
          hubspot_account_domain = COALESCE(EXCLUDED.hubspot_account_domain, hubspot_accounts.hubspot_account_domain),
          display_name = CASE
            WHEN hubspot_accounts.display_name_is_custom THEN hubspot_accounts.display_name
            ELSE COALESCE(EXCLUDED.display_name, hubspot_accounts.display_name)
          END,
          display_name_is_custom = hubspot_accounts.display_name_is_custom OR EXCLUDED.display_name_is_custom,
          updated_at = NOW()
        RETURNING *
      `,
      [
        tenantId,
        connection.hubspot_portal_id ? String(connection.hubspot_portal_id) : null,
        connection.access_token,
        connection.refresh_token,
        name,
        domain,
        timezone,
        currency,
        displayName
      ]
    );

    return result.rows[0];
  } catch (error) {
    const isUndefinedColumn =
      error && (error.code === '42703' || /column .* does not exist/i.test(String(error.message || '')));

    if (!isUndefinedColumn) {
      throw error;
    }

    try {
      const legacyResult = await upsertHubSpotAccountLegacy(tenantId, connection, details);
      return legacyResult.rows[0];
    } catch (legacyError) {
      const baseResult = await upsertHubSpotAccountBase(tenantId, connection);
      return baseResult.rows[0];
    }
  }
}

async function syncTenantHubSpotAccount(tenantId) {
  const connection = await tokenService.getConnection(String(tenantId));

  if (!connection) {
    throw new AppError('HubSpot account is not connected', 404, 'hubspot_not_connected');
  }

  const details = await accountLabelService.resolveHubSpotAccountMetadata(String(tenantId)).catch(() => null);

  return upsertHubSpotAccountForTenant(tenantId, connection, details || {});
}

async function getTenantHubSpotAccount(tenantId) {
  const result = await db.query(
    `
      SELECT *
      FROM hubspot_accounts
      WHERE tenant_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [tenantId]
  );

  return result.rows[0] || null;
}

async function listTenantHubSpotAccounts(tenantId) {
  const result = await db.query(
    `
      SELECT *
      FROM hubspot_accounts
      WHERE tenant_id = $1
      ORDER BY updated_at DESC
    `,
    [tenantId]
  );

  const active = await tokenService.getConnection(String(tenantId));
  const activePortalId = active && active.hubspot_portal_id ? String(active.hubspot_portal_id) : null;

  return result.rows.map((row) => ({
    id: row.id,
    hubspot_portal_id: row.hubspot_account_id ? String(row.hubspot_account_id) : null,
    account_name: row.account_name || null,
    account_domain: row.account_domain || null,
    account_timezone: row.account_timezone || null,
    account_currency: row.account_currency || null,
    hubspot_account_name: row.hubspot_account_name || null,
    hubspot_account_domain: row.hubspot_account_domain || null,
    account_display_name:
      row.display_name ||
      row.account_name ||
      row.account_domain ||
      row.hubspot_account_name ||
      row.hubspot_account_domain ||
      (row.hubspot_account_id ? String(row.hubspot_account_id) : null),
    display_name:
      row.display_name ||
      row.account_name ||
      row.account_domain ||
      row.hubspot_account_name ||
      row.hubspot_account_domain ||
      (row.hubspot_account_id ? String(row.hubspot_account_id) : null),
    display_name_is_custom: Boolean(row.display_name_is_custom),
    connected_at: row.connected_at,
    updated_at: row.updated_at,
    is_active:
      activePortalId && row.hubspot_account_id
        ? String(row.hubspot_account_id) === String(activePortalId)
        : false
  }));
}

async function switchActiveHubSpotAccount(tenantId, portalId) {
  if (!tenantId) {
    throw new AppError('Authentication required', 401, 'authentication_required');
  }

  const safePortalId = String(portalId || '');
  if (!safePortalId) {
    throw new AppError('Missing portalId', 400, 'missing_portal_id');
  }

  const accountResult = await db.query(
    `
      SELECT *
      FROM hubspot_accounts
      WHERE tenant_id = $1 AND hubspot_account_id = $2
      LIMIT 1
    `,
    [tenantId, safePortalId]
  );

  if (accountResult.rowCount === 0) {
    throw new AppError('HubSpot account not found for tenant', 404, 'hubspot_account_not_found');
  }

  const account = accountResult.rows[0];

  // Swap the active connection for this tenant so the existing token service + fetchers continue to work.
  // We set token_expires_at = NOW() to force a refresh on next use, since we don't persist expiry per account yet.
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
      VALUES ($1, $2, $3, $4, NOW(), 'bearer', NULL, NOW())
      ON CONFLICT (internal_account_key)
      DO UPDATE SET
        hubspot_portal_id = EXCLUDED.hubspot_portal_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        token_type = EXCLUDED.token_type,
        updated_at = NOW()
    `,
    [String(tenantId), safePortalId, account.access_token, account.refresh_token]
  );

  return {
    hubspot_portal_id: safePortalId
  };
}

async function updateTenantHubSpotAccountMeta(tenantId, portalId, meta = {}) {
  const name = meta.hubspot_account_name || meta.name || null;
  const domain = meta.hubspot_account_domain || meta.domain || null;
  const timezone = meta.account_timezone || meta.timeZone || meta.timezone || null;
  const currency = meta.account_currency || meta.currency || null;
  const displayName = meta.display_name || meta.displayName || meta.brandName || meta.account_display_name || name || domain || null;

  try {
    const result = await db.query(
      `
        UPDATE hubspot_accounts
        SET account_name = COALESCE($3, account_name),
            account_domain = COALESCE($4, account_domain),
            account_timezone = COALESCE($5, account_timezone),
            account_currency = COALESCE($6, account_currency),
            hubspot_account_name = COALESCE($3, hubspot_account_name),
            hubspot_account_domain = COALESCE($4, hubspot_account_domain),
            display_name = CASE
              WHEN display_name_is_custom THEN display_name
              ELSE COALESCE($7, display_name)
            END,
            updated_at = NOW()
        WHERE tenant_id = $1 AND hubspot_account_id = $2
        RETURNING id, hubspot_account_id, hubspot_account_name, hubspot_account_domain, updated_at
      `,
      [tenantId, String(portalId), name, domain, timezone, currency, displayName]
    );

    return result.rows[0] || null;
  } catch (error) {
    const isUndefinedColumn =
      error && (error.code === '42703' || /column .* does not exist/i.test(String(error.message || '')));

    if (!isUndefinedColumn) {
      throw error;
    }

    const legacyResult = await updateTenantHubSpotAccountMetaLegacy(tenantId, portalId, meta);
    return legacyResult || null;
  }
}

async function updateTenantHubSpotAccountMetaLegacy(tenantId, portalId, meta = {}) {
  const name = meta.hubspot_account_name || meta.name || null;
  const domain = meta.hubspot_account_domain || meta.domain || null;

  const result = await db.query(
    `
      UPDATE hubspot_accounts
      SET hubspot_account_name = COALESCE($3, hubspot_account_name),
          hubspot_account_domain = COALESCE($4, hubspot_account_domain),
          updated_at = NOW()
      WHERE tenant_id = $1 AND hubspot_account_id = $2
      RETURNING id, hubspot_account_id, hubspot_account_name, hubspot_account_domain, updated_at
    `,
    [tenantId, String(portalId), name, domain]
  );

  return result.rows[0] || null;
}

async function setTenantHubSpotAccountDisplayName(tenantId, portalId, displayName) {
  const safeName = String(displayName || '').trim();
  if (!safeName) {
    throw new AppError('Missing displayName', 400, 'missing_display_name');
  }

  const result = await db.query(
    `
      UPDATE hubspot_accounts
      SET display_name = $3,
          display_name_is_custom = TRUE,
          updated_at = NOW()
      WHERE tenant_id = $1 AND hubspot_account_id = $2
      RETURNING id, hubspot_account_id, display_name, hubspot_account_name, hubspot_account_domain, updated_at
    `,
    [tenantId, String(portalId), safeName]
  );

  if (result.rowCount === 0) {
    throw new AppError('HubSpot account not found for tenant', 404, 'hubspot_account_not_found');
  }

  return result.rows[0];
}

async function deleteTenantHubSpotAccount(tenantId, portalId) {
  if (!tenantId) {
    throw new AppError('Authentication required', 401, 'authentication_required');
  }

  const safePortalId = String(portalId || '').trim();
  if (!safePortalId) {
    throw new AppError('Missing portalId', 400, 'missing_portal_id');
  }

  const activeConnection = await tokenService.getConnection(String(tenantId)).catch(() => null);
  const wasActive =
    activeConnection && String(activeConnection.hubspot_portal_id || '') === String(safePortalId);

  const client = await db.pool.connect();
  let nextAccount = null;

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `
        SELECT id
        FROM hubspot_accounts
        WHERE tenant_id = $1 AND hubspot_account_id = $2
        LIMIT 1
      `,
      [tenantId, safePortalId]
    );

    if (existing.rowCount === 0) {
      throw new AppError('HubSpot account not found for tenant', 404, 'hubspot_account_not_found');
    }

    const accountRowId = existing.rows[0].id;

    await client.query(
      `
        UPDATE audits
        SET hubspot_account_uuid = NULL
        WHERE tenant_id = $1
          AND hubspot_account_uuid = $2
      `,
      [tenantId, accountRowId]
    );

    await client.query(
      `
        DELETE FROM hubspot_accounts
        WHERE tenant_id = $1 AND hubspot_account_id = $2
      `,
      [tenantId, safePortalId]
    );

    const nextResult = await client.query(
      `
        SELECT hubspot_account_id
        FROM hubspot_accounts
        WHERE tenant_id = $1
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [tenantId]
    );

    nextAccount = nextResult.rows[0] || null;

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (nextAccount && (wasActive || !activeConnection)) {
    await switchActiveHubSpotAccount(tenantId, nextAccount.hubspot_account_id);
  } else if (!nextAccount) {
    await tokenService.clearConnection(String(tenantId));
  }

  return {
    deleted_portal_id: safePortalId,
    next_active_portal_id: nextAccount ? String(nextAccount.hubspot_account_id) : null
  };
}

module.exports = {
  upsertHubSpotAccountForTenant,
  syncTenantHubSpotAccount,
  getTenantHubSpotAccount,
  listTenantHubSpotAccounts,
  switchActiveHubSpotAccount,
  updateTenantHubSpotAccountMeta,
  setTenantHubSpotAccountDisplayName,
  deleteTenantHubSpotAccount
};
