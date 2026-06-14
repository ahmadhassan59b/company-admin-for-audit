const hubspotClient = require('./client');
const env = require('../../config/env');

async function fetchWorkflows(accountKey) {
  return hubspotClient.getPagedResults(accountKey, '/automation/v4/flows', {
    limit: 100,
    maxResults: Math.max(1, Number(env.hubspotAuditRecordLimit) || 300)
  });
}

module.exports = {
  fetchWorkflows
};
