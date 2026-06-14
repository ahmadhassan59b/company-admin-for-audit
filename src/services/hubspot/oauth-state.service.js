const crypto = require('crypto');
const db = require('../../config/db');
const { AppError } = require('../../utils/errors');

const OAUTH_STATE_TTL_MINUTES = 15;

function normalizeStateValue(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }

  return String(value || '').trim();
}

async function createOAuthState(accountKey) {
  const normalizedAccountKey = String(accountKey || '').trim();

  if (!normalizedAccountKey) {
    throw new AppError('Missing account key', 400, 'missing_account_key');
  }

  const stateId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60 * 1000);

  await db.query(
    `
      INSERT INTO hubspot_oauth_states (
        state_id,
        account_key,
        expires_at
      )
      VALUES ($1, $2, $3)
    `,
    [stateId, normalizedAccountKey, expiresAt]
  );

  return stateId;
}

async function loadOAuthState(state) {
  const normalizedState = normalizeStateValue(state);

  if (!normalizedState) {
    throw new AppError('Missing OAuth state', 400, 'missing_oauth_state');
  }

  const result = await db.query(
    `
      SELECT account_key
      FROM hubspot_oauth_states
      WHERE state_id = $1
        AND expires_at > NOW()
    `,
    [normalizedState]
  );

  if (result.rowCount === 0) {
    throw new AppError('OAuth state is invalid or expired', 400, 'invalid_oauth_state');
  }

  return result.rows[0].account_key;
}

async function invalidateOAuthState(state) {
  const normalizedState = normalizeStateValue(state);

  if (!normalizedState) {
    return false;
  }

  await db.query(
    `
      DELETE FROM hubspot_oauth_states
      WHERE state_id = $1
    `,
    [normalizedState]
  );

  return true;
}

module.exports = {
  createOAuthState,
  loadOAuthState,
  invalidateOAuthState
};
