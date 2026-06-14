const hubspotClient = require('./client');
const env = require('../../config/env');

const STALE_DEAL_DAYS = 30;

function staleCutoffTimestamp() {
  return Date.now() - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000;
}

async function searchDealCount(accountKey, filters) {
  const data = await hubspotClient.request(accountKey, {
    method: 'POST',
    url: '/crm/v3/objects/deals/search',
    data: {
      limit: 1,
      properties: ['pipeline', 'dealstage', 'hs_lastmodifieddate'],
      filterGroups: [
        {
          filters
        }
      ]
    }
  });

  return data.total || 0;
}

async function fetchPipelineDealStats(accountKey, pipelineId) {
  const pipelineFilter = {
    propertyName: 'pipeline',
    operator: 'EQ',
    value: pipelineId
  };

  const dealsCount = await searchDealCount(accountKey, [pipelineFilter]);
  const staleDeals = await searchDealCount(accountKey, [
      pipelineFilter,
      {
        propertyName: 'hs_lastmodifieddate',
        operator: 'LT',
        value: String(staleCutoffTimestamp())
      }
    ]);

  return {
    dealsCount,
    staleDeals
  };
}

function parseAssociations(record) {
  const associations = record && record.associations && typeof record.associations === 'object'
    ? record.associations
    : {};

  const companyIds = [];
  const companyAssociation = associations.companies;

  if (companyAssociation && Array.isArray(companyAssociation.results)) {
    companyAssociation.results.forEach((item) => {
      if (item && item.id !== null && item.id !== undefined) {
        companyIds.push(String(item.id));
      }
    });
  }

  return Array.from(new Set(companyIds));
}

function normalizeDeal(record) {
  const properties = record && record.properties && typeof record.properties === 'object' ? record.properties : {};
  const companyId =
    String(
      properties.associatedcompanyid ||
      properties.associatedCompanyId ||
      properties.company ||
      record.associatedcompanyid ||
      record.associatedCompanyId ||
      ''
    ).trim();

  return {
    id: record.id || properties.hs_object_id || null,
    name: String(properties.dealname || record.dealname || '').trim(),
    pipeline: String(properties.pipeline || record.pipeline || '').trim(),
    stage: String(properties.dealstage || record.dealstage || '').trim(),
    ownerId: String(properties.hubspot_owner_id || record.hubspot_owner_id || '').trim(),
    associatedCompanyId: companyId || null,
    associatedCompanyIds: parseAssociations(record),
    closeDate: String(properties.closedate || record.closedate || '').trim(),
    createdAt: String(properties.createdate || record.createdate || '').trim(),
    amount: String(properties.amount || record.amount || '').trim(),
    updatedAt: record.updatedAt || properties.hs_lastmodifieddate || null,
    archived: Boolean(record.archived)
  };
}

async function fetchDeals(accountKey) {
  const results = [];
  let after = null;
  const maxResults = Math.max(1, Number(env.hubspotAuditRecordLimit) || 300);

  do {
    const data = await hubspotClient.request(accountKey, {
      method: 'GET',
      url: '/crm/v3/objects/deals',
      params: {
        limit: 100,
        archived: false,
        after,
        associations: 'companies',
        properties: 'dealname,pipeline,dealstage,hubspot_owner_id,associatedcompanyid,closedate,createdate,amount,hs_lastmodifieddate'
      }
    });

    if (Array.isArray(data.results)) {
      results.push(...data.results.map(normalizeDeal));
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
  fetchPipelineDealStats,
  fetchDeals
};
