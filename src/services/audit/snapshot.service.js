const dealsService = require('../hubspot/deals.service');
const formsService = require('../hubspot/forms.service');
const usersService = require('../hubspot/users.service');

function daysSince(dateValue) {
  if (!dateValue) return null;
  const value = new Date(dateValue).getTime();
  if (Number.isNaN(value)) return null;
  return Math.floor((Date.now() - value) / (24 * 60 * 60 * 1000));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

async function buildPipelineSnapshot(accountKey, pipelines) {
  return mapWithConcurrency(pipelines, 1, async (pipeline) => {
    const stats = await dealsService.fetchPipelineDealStats(accountKey, pipeline.id);

    return {
      id: pipeline.id,
      name: pipeline.label || pipeline.name || 'Untitled pipeline',
      stages: Array.isArray(pipeline.stages) ? pipeline.stages.length : 0,
      deals_count: stats.dealsCount,
      stale_deals: stats.staleDeals
    };
  });
}

function buildWorkflowSnapshot(workflows) {
  return workflows.map((workflow) => {
    const isEnabled = Boolean(workflow.isEnabled ?? workflow.enabled);
    const lastTouchedAt =
      workflow.lastTriggeredAt ||
      workflow.lastEnrollmentAt ||
      workflow.updatedAt ||
      workflow.createdAt ||
      null;

    return {
      id: workflow.id || workflow.flowId || workflow.uuid,
      name: workflow.name || workflow.label || 'Untitled workflow',
      status: isEnabled && !workflow.archived ? 'active' : 'inactive',
      last_triggered_days_ago: daysSince(lastTouchedAt)
    };
  });
}

async function buildFormSnapshot(accountKey, forms) {
  return mapWithConcurrency(forms, 5, async (form) => {
    const formId = form.id || form.guid;
    let submissionsLast30Days = 0;
    let submissionsAvailable = Boolean(formId);

    if (formId) {
      try {
        submissionsLast30Days = await formsService.fetchSubmissionCountLast30Days(
          accountKey,
          formId
        );
      } catch (error) {
        submissionsAvailable = false;
      }
    }

    return {
      id: formId,
      name: form.name || 'Untitled form',
      submissions_last_30_days: submissionsLast30Days,
      submissions_available: submissionsAvailable
    };
  });
}

async function buildUsageSnapshot(accountKey) {
  try {
    const users = await usersService.fetchUsers(accountKey);
    const activeUsers = users.filter(
      (user) => user.active !== false && user.archived !== true && user.deactivated !== true
    );

    return {
      active_users: activeUsers.length,
      total_users: users.length,
      status: 'available'
    };
  } catch (error) {
    return {
      active_users: 0,
      total_users: 0,
      status: 'unavailable'
    };
  }
}

function buildDataCleanlinessSnapshot(rawData) {
  const capabilities = rawData._capabilities || {};
  const propertiesAvailable = capabilities.properties !== 'unavailable';

  if (!propertiesAvailable) {
    return {
      status: 'unavailable',
      custom_contact_properties: 0,
      custom_deal_properties: 0,
      total_contact_properties: 0,
      total_deal_properties: 0
    };
  }

  const contactCustomProperties = rawData.contactProperties.filter(
    (property) => !property.hubspotDefined
  );
  const dealCustomProperties = rawData.dealProperties.filter(
    (property) => !property.hubspotDefined
  );

  return {
    status: 'available',
    custom_contact_properties: contactCustomProperties.length,
    custom_deal_properties: dealCustomProperties.length,
    total_contact_properties: rawData.contactProperties.length,
    total_deal_properties: rawData.dealProperties.length
  };
}

async function buildAuditSnapshot(rawData, accountKey, scope = null) {
  const [contacts, companies, emails, deals, pipelines, forms, usage] = await Promise.all([
    Array.isArray(rawData.contacts) ? rawData.contacts : [],
    Array.isArray(rawData.companies) ? rawData.companies : [],
    Array.isArray(rawData.emails) ? rawData.emails : [],
    Array.isArray(rawData.deals) ? rawData.deals : [],
    buildPipelineSnapshot(accountKey, rawData.pipelines),
    buildFormSnapshot(accountKey, rawData.forms),
    buildUsageSnapshot(accountKey)
  ]);

  return {
    contacts,
    companies,
    emails,
    deals,
    pipelines,
    workflows: buildWorkflowSnapshot(rawData.workflows),
    forms,
    usage,
    data_cleanliness: buildDataCleanlinessSnapshot(rawData),
    capabilities: rawData._capabilities || null,
    scope: Array.isArray(scope) ? scope.slice() : null
  };
}

module.exports = {
  buildAuditSnapshot
};
