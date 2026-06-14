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

function normalizeCompany(record) {
  const properties = parseProperties(record);
  return {
    id: record.id || properties.hs_object_id || null,
    name: String(properties.name || record.name || '').trim(),
    domain: String(properties.domain || record.domain || '').trim(),
    website: String(properties.website || record.website || '').trim(),
    phone: String(properties.phone || record.phone || '').trim(),
    industry: String(properties.industry || record.industry || '').trim(),
    employees: String(properties.numberofemployees || record.numberofemployees || '').trim(),
    country: String(properties.country || record.country || '').trim(),
    annualRevenue: String(properties.annualrevenue || record.annualrevenue || '').trim(),
    ownerId: String(properties.hubspot_owner_id || record.hubspot_owner_id || '').trim(),
    updatedAt: record.updatedAt || properties.hs_lastmodifieddate || null,
    archived: Boolean(record.archived)
  };
}

async function fetchCompanies(accountKey) {
  const results = [];
  let after = null;
  const maxResults = Math.max(1, Number(env.hubspotAuditRecordLimit) || 300);

  do {
    const data = await hubspotClient.request(accountKey, {
      method: 'GET',
      url: '/crm/v3/objects/companies',
      params: {
        limit: 100,
        archived: false,
        after,
        properties: 'name,domain,website,phone,industry,numberofemployees,country,annualrevenue,hubspot_owner_id,hs_lastmodifieddate'
      }
    });

    if (Array.isArray(data.results)) {
      results.push(...data.results.map(normalizeCompany));
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
  fetchCompanies
};
