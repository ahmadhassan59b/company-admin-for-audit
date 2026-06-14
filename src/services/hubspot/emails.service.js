const hubspotClient = require('./client');
const env = require('../../config/env');

function parseProperties(record) {
  const raw = record && record.properties;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeEmail(record) {
  const properties = parseProperties(record);
  return {
    id: record.id || properties.hs_object_id || null,
    subject: String(properties.hs_email_subject || record.hs_email_subject || '').trim(),
    timestamp: String(properties.hs_timestamp || record.hs_timestamp || '').trim(),
    ownerId: String(properties.hubspot_owner_id || record.hubspot_owner_id || '').trim(),
    direction: String(properties.hs_email_direction || record.hs_email_direction || '').trim(),
    updatedAt: record.updatedAt || properties.hs_lastmodifieddate || null,
    archived: Boolean(record.archived)
  };
}

async function fetchEmails(accountKey) {
  const results = [];
  let after = null;
  const maxResults = Math.max(1, Number(env.hubspotAuditRecordLimit) || 300);

  do {
    const data = await hubspotClient.request(accountKey, {
      method: 'GET',
      url: '/crm/v3/objects/emails',
      params: {
        limit: 100,
        archived: false,
        after,
        properties: 'hs_email_subject,hs_timestamp,hubspot_owner_id,hs_email_direction,hs_lastmodifieddate'
      }
    });

    if (Array.isArray(data.results)) {
      results.push(...data.results.map(normalizeEmail));
    }

    if (results.length >= maxResults) {
      results.length = maxResults;
      break;
    }

    after = data.paging && data.paging.next ? data.paging.next.after : null;
  } while (after);

  return results;
}

module.exports = {
  fetchEmails
};
