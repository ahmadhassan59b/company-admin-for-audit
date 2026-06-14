#!/usr/bin/env node
const crypto = require('crypto');
const axios = require('axios');
const db = require('../src/config/db');
const env = require('../src/config/env');
const oauthService = require('../src/services/hubspot/oauth.service');

function getKey() {
  return crypto.createHash('sha256').update(String(env.tokenEncryptionKey || '')).digest();
}

function decryptToken(value) {
  if (!value || !String(value).startsWith('enc:v1:')) return value;

  const parts = String(value).split(':');
  if (parts.length < 5) return value;

  const [, , ivValue, tagValue, encryptedValue] = parts;
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

function encryptToken(value) {
  if (!value) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

async function fetchHubSpotAccountInfo(accessToken) {
  const response = await axios.get('https://api.hubapi.com/account-info/v3/details', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    timeout: 15000
  });

  return response.data;
}

function pickAccountInfo(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      accountName: null,
      accountDomain: null,
      accountTimezone: null,
      accountCurrency: null
    };
  }

  return {
    accountName:
      payload.companyName ||
      payload.company_name ||
      payload.portalName ||
      payload.portal_name ||
      payload.name ||
      null,
    accountDomain:
      payload.domain ||
      payload.hubDomain ||
      payload.hub_domain ||
      payload.portalDomain ||
      payload.portal_domain ||
      null,
    accountTimezone: payload.timeZone || payload.timezone || null,
    accountCurrency: payload.currency || null
  };
}

async function processAccount(row) {
  const accessToken = decryptToken(row.access_token);
  const refreshToken = decryptToken(row.refresh_token);

  if (!accessToken || !refreshToken) {
    return { status: 'skipped', reason: 'missing_tokens' };
  }

  let fetched = null;
  let refreshedTokens = null;

  try {
    fetched = await fetchHubSpotAccountInfo(accessToken);
  } catch (error) {
    const status = error.response ? error.response.status : null;
    if (status !== 401) {
      return { status: 'failed', reason: `fetch_failed:${error.message}` };
    }

    try {
      const refreshed = await oauthService.refreshAccessToken(refreshToken);
      refreshedTokens = refreshed;
      fetched = await fetchHubSpotAccountInfo(refreshed.access_token);
    } catch (refreshError) {
      return { status: 'failed', reason: `refresh_failed:${refreshError.message}` };
    }
  }

  const info = pickAccountInfo(fetched);
  const nextAccessToken = refreshedTokens ? encryptToken(refreshedTokens.access_token) : null;
  const nextRefreshToken = refreshedTokens && refreshedTokens.refresh_token
    ? encryptToken(refreshedTokens.refresh_token)
    : null;

  await db.query(
    `
      UPDATE hubspot_accounts
      SET account_name = COALESCE($2, account_name),
          account_domain = COALESCE($3, account_domain),
          account_timezone = COALESCE($4, account_timezone),
          account_currency = COALESCE($5, account_currency),
          hubspot_account_name = COALESCE($2, hubspot_account_name),
          hubspot_account_domain = COALESCE($3, hubspot_account_domain),
          access_token = COALESCE($6, access_token),
          refresh_token = COALESCE($7, refresh_token),
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      row.id,
      info.accountName,
      info.accountDomain,
      info.accountTimezone,
      info.accountCurrency,
      nextAccessToken,
      nextRefreshToken
    ]
  );

  return {
    status: 'updated',
    name: info.accountName,
    domain: info.accountDomain
  };
}

async function main() {
  const tenantFilter = process.argv.find((arg) => arg.startsWith('--tenant-id='));
  const force = process.argv.includes('--force');
  const tenantId = tenantFilter ? tenantFilter.split('=')[1] : null;

  const params = [];
  const where = [];
  if (tenantId) {
    params.push(tenantId);
    where.push(`tenant_id = $${params.length}`);
  }

  const query = `
    SELECT
      id,
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
      display_name_is_custom
    FROM hubspot_accounts
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY updated_at DESC
  `;

  const result = await db.query(query, params);
  const rows = result.rows || [];

  console.log(`Found ${rows.length} hubspot account row(s).`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const hasMetadata = Boolean(
      row.account_name &&
      row.account_domain &&
      row.account_timezone &&
      row.account_currency &&
      row.hubspot_account_name &&
      row.hubspot_account_domain
    );
    if (hasMetadata && !force) {
      skipped += 1;
      console.log(`Skipping ${row.hubspot_account_id || row.id} (already has metadata).`);
      continue;
    }

    try {
      const outcome = await processAccount(row);
      if (outcome.status === 'updated') {
        updated += 1;
        console.log(
          `Updated ${row.hubspot_account_id || row.id}: ${outcome.name || 'n/a'} / ${outcome.domain || 'n/a'}`
        );
      } else if (outcome.status === 'skipped') {
        skipped += 1;
        console.log(`Skipping ${row.hubspot_account_id || row.id} (${outcome.reason}).`);
      } else {
        failed += 1;
        console.warn(`Failed ${row.hubspot_account_id || row.id}: ${outcome.reason}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`Failed ${row.hubspot_account_id || row.id}: ${error.message}`);
    }
  }

  console.log(`Done. Updated: ${updated}, skipped: ${skipped}, failed: ${failed}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
