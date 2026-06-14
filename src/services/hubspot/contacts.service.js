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

function normalizeContact(record) {
  const properties = parseProperties(record);
  return {
    id: record.id || properties.hs_object_id || null,
    email: String(properties.email || record.email || '').trim(),
    firstname: String(properties.firstname || record.firstname || '').trim(),
    lastname: String(properties.lastname || record.lastname || '').trim(),
    lifecycleStage: String(properties.lifecyclestage || record.lifecyclestage || '').trim(),
    phone: String(properties.phone || record.phone || '').trim(),
    jobTitle: String(properties.jobtitle || record.jobtitle || '').trim(),
    company: String(properties.company || record.company || '').trim(),
    ownerId: String(properties.hubspot_owner_id || record.hubspot_owner_id || '').trim(),
    updatedAt: record.updatedAt || properties.lastmodifieddate || null,
    archived: Boolean(record.archived)
  };
}

async function fetchContacts(accountKey) {
  const results = [];
  let after = null;
  const maxResults = Math.max(1, Number(env.hubspotAuditRecordLimit) || 300);

  do {
    const data = await hubspotClient.request(accountKey, {
      method: 'GET',
      url: '/crm/v3/objects/contacts',
      params: {
        limit: 100,
        archived: false,
        after,
        properties: 'email,firstname,lastname,lifecyclestage,phone,jobtitle,company,hubspot_owner_id,hs_lastmodifieddate'
      }
    });

    if (Array.isArray(data.results)) {
      results.push(...data.results.map(normalizeContact));
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
  fetchContacts
};
