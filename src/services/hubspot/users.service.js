const hubspotClient = require('./client');
const env = require('../../config/env');

async function fetchUsers(accountKey) {
  return hubspotClient.getPagedResults(accountKey, '/settings/users/2026-03', {
    limit: 100,
    maxResults: Math.max(1, Number(env.hubspotAuditRecordLimit) || 300)
  });
}

module.exports = {
  fetchUsers
};
