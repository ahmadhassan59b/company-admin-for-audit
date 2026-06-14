const crypto = require('crypto');

function optimizeSnapshot(snapshot, issues = [], context = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const pipelines = Array.isArray(snapshot.pipelines) ? snapshot.pipelines : [];
  const workflows = Array.isArray(snapshot.workflows) ? snapshot.workflows : [];
  const forms = Array.isArray(snapshot.forms) ? snapshot.forms : [];
  const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
  const companies = Array.isArray(snapshot.companies) ? snapshot.companies : [];
  const emails = Array.isArray(snapshot.emails) ? snapshot.emails : [];
  const deals = Array.isArray(snapshot.deals) ? snapshot.deals : [];
  const usage = snapshot.usage && typeof snapshot.usage === 'object' ? snapshot.usage : {};
  const dataCleanliness =
    snapshot.data_cleanliness && typeof snapshot.data_cleanliness === 'object'
      ? snapshot.data_cleanliness
      : {};
  const relevantSections = deriveRelevantSections(issues, context);

  const pipelineSignals = pipelines
    .map((pipeline) => ({
      name: pipeline.name || 'Untitled pipeline',
      stage_count: normalizeNumber(pipeline.stages),
      deals_count: normalizeNumber(pipeline.deals_count),
      stale_deals: normalizeNumber(pipeline.stale_deals),
      stale_ratio:
        normalizeNumber(pipeline.deals_count) > 0
          ? roundRatio(normalizeNumber(pipeline.stale_deals), normalizeNumber(pipeline.deals_count))
          : null
    }))
    .sort((a, b) => (b.stale_ratio || 0) - (a.stale_ratio || 0))
    .slice(0, 5);

  const optimized = {
    counts: {
      contact_count: contacts.length,
      company_count: companies.length,
      email_count: emails.length,
      deal_count: deals.length,
      pipeline_count: pipelines.length,
      workflow_count: workflows.length,
      form_count: forms.length
    },
    included_sections: []
  };

  if (relevantSections.has('contacts') || contacts.length > 0) {
    optimized.contacts = contacts.slice(0, 5).map((contact) => ({
      email: String(contact.email || '').trim() || null,
      firstname: String(contact.firstname || '').trim() || null,
      lastname: String(contact.lastname || '').trim() || null,
      lifecycleStage: String(contact.lifecycleStage || '').trim() || null,
      phone: String(contact.phone || '').trim() || null,
      company: String(contact.company || '').trim() || null,
      ownerId: String(contact.ownerId || '').trim() || null,
      jobTitle: String(contact.jobTitle || '').trim() || null
    }));
    optimized.included_sections.push('contacts');
  }

  if (relevantSections.has('companies') || companies.length > 0) {
    optimized.companies = companies.slice(0, 5).map((company) => ({
      name: String(company.name || '').trim() || null,
      domain: String(company.domain || '').trim() || null,
      website: String(company.website || '').trim() || null,
      phone: String(company.phone || '').trim() || null,
      industry: String(company.industry || '').trim() || null,
      employees: String(company.employees || '').trim() || null,
      country: String(company.country || '').trim() || null,
      annualRevenue: String(company.annualRevenue || '').trim() || null
    }));
    optimized.included_sections.push('companies');
  }

  if (relevantSections.has('emails') || emails.length > 0) {
    optimized.emails = emails.slice(0, 5).map((email) => ({
      subject: String(email.subject || '').trim() || null,
      timestamp: String(email.timestamp || '').trim() || null,
      ownerId: String(email.ownerId || '').trim() || null
    }));
    optimized.included_sections.push('emails');
  }

  if (relevantSections.has('deals') || deals.length > 0) {
    optimized.deals = deals.slice(0, 10).map((deal) => ({
      name: String(deal.name || '').trim() || null,
      pipeline: String(deal.pipeline || '').trim() || null,
      stage: String(deal.stage || '').trim() || null,
      ownerId: String(deal.ownerId || '').trim() || null,
      associatedCompanyId: String(deal.associatedCompanyId || '').trim() || null,
      closeDate: String(deal.closeDate || '').trim() || null,
      amount: String(deal.amount || '').trim() || null,
      updatedAt: String(deal.updatedAt || '').trim() || null,
      associatedCompanyIds: Array.isArray(deal.associatedCompanyIds)
        ? deal.associatedCompanyIds.slice(0, 5).map((value) => String(value).trim()).filter(Boolean)
        : []
    }));
    optimized.included_sections.push('deals');
  }

  if (relevantSections.has('pipelines') || pipelines.length > 0) {
    optimized.pipelines = pipelineSignals;
    optimized.included_sections.push('pipelines');
  }

  if (relevantSections.has('workflows') || workflows.length > 0) {
    const activeWorkflows = workflows.filter((workflow) => isWorkflowActive(workflow));
    const inactiveWorkflows = workflows
      .filter((workflow) => !isWorkflowActive(workflow))
      .sort((a, b) => daysAgo(b) - daysAgo(a))
      .slice(0, 5)
      .map((workflow) => ({
        name: workflow.name || 'Untitled workflow',
        last_triggered_days_ago: daysAgo(workflow)
      }));

    optimized.workflows = {
      total: workflows.length,
      active: activeWorkflows.length,
      inactive: Math.max(workflows.length - activeWorkflows.length, 0),
      sample: inactiveWorkflows
    };
    optimized.included_sections.push('workflows');
  }

  if (relevantSections.has('forms') || forms.length > 0) {
    const submissionsWithActivity = forms
      .filter((form) => normalizeNumber(form.submissions_last_30_days) > 0)
      .sort((a, b) => normalizeNumber(b.submissions_last_30_days) - normalizeNumber(a.submissions_last_30_days))
      .slice(0, 5)
      .map((form) => ({
        name: form.name || 'Untitled form',
        submissions_last_30_days: normalizeNumber(form.submissions_last_30_days)
      }));

    const lowActivityForms = forms
      .filter((form) => normalizeNumber(form.submissions_last_30_days) === 0)
      .slice(0, 5)
      .map((form) => ({
        name: form.name || 'Untitled form',
        submissions_last_30_days: 0
      }));

    optimized.forms = {
      total: forms.length,
      with_submissions: submissionsWithActivity.length,
      without_submissions: Math.max(forms.length - submissionsWithActivity.length, 0),
      sample: lowActivityForms.concat(submissionsWithActivity).slice(0, 5)
    };
    optimized.included_sections.push('forms');
  }

  if (relevantSections.has('usage') || usage.status || normalizeNumber(usage.active_users) || normalizeNumber(usage.total_users)) {
    optimized.usage = {
      status: usage.status || null,
      active_users: normalizeNumber(usage.active_users),
      total_users: normalizeNumber(usage.total_users)
    };
    optimized.included_sections.push('usage');
  }

  if (
    relevantSections.has('data_cleanliness') ||
    normalizeNumber(dataCleanliness.custom_contact_properties) ||
    normalizeNumber(dataCleanliness.custom_deal_properties) ||
    normalizeNumber(dataCleanliness.total_contact_properties) ||
    normalizeNumber(dataCleanliness.total_deal_properties)
  ) {
    optimized.data_cleanliness = {
      status: dataCleanliness.status || null,
      custom_contact_properties: normalizeNumber(dataCleanliness.custom_contact_properties),
      custom_deal_properties: normalizeNumber(dataCleanliness.custom_deal_properties),
      total_contact_properties: normalizeNumber(dataCleanliness.total_contact_properties),
      total_deal_properties: normalizeNumber(dataCleanliness.total_deal_properties)
    };
    optimized.included_sections.push('data_cleanliness');
  }

  const capabilities = summarizeCapabilities(snapshot.capabilities || null, relevantSections);
  if (capabilities) {
    optimized.capabilities = capabilities;
    optimized.included_sections.push('capabilities');
  }

  optimized.included_sections = Array.from(new Set(optimized.included_sections));

  return optimized;
}

function limitOptimizedSnapshotSize(snapshot, maxChars = 8000) {
  if (!snapshot) return null;

  const fullText = JSON.stringify(snapshot);
  if (fullText.length <= maxChars) {
    return snapshot;
  }

  const minimal = buildMinimalSnapshot(snapshot);
  if (JSON.stringify(minimal).length <= maxChars) {
    return minimal;
  }

  return {
    counts: snapshot.counts || {
      pipeline_count: 0,
      workflow_count: 0,
      form_count: 0
    },
    usage: snapshot.usage || null,
    data_cleanliness: snapshot.data_cleanliness || null,
    capabilities: snapshot.capabilities || null
  };
}

function buildAiFactsPayload(snapshot, issues, promptMode = 'compact', maxChars = 8000, context = {}) {
  const normalizedMode = normalizePromptMode(promptMode);
  const optimizedSnapshot = limitOptimizedSnapshotSize(optimizeSnapshot(snapshot, issues, context), maxChars);
  const safeIssues = normalizeIssues(issues);
  const objectType = String(context.objectType || '').toLowerCase() || null;
  const objectLabel = context.objectLabel || null;

  if (normalizedMode === 'full') {
    return {
      snapshot: optimizedSnapshot,
      context: {
        object_type: objectType,
        object_label: objectLabel
      },
      issue_buckets: summarizeIssueBuckets(safeIssues),
      issue_count: safeIssues.length
    };
  }

  return {
    snapshot: optimizedSnapshot,
    context: {
      object_type: objectType,
      object_label: objectLabel
    },
    issue_summary: summarizeIssues(safeIssues)
  };
}

function summarizeIssues(issues) {
  const countsBySeverity = { high: 0, medium: 0, low: 0 };
  const countsByCategory = {};

  const sorted = [...normalizeIssues(issues)].sort((a, b) => {
    const severityDiff = severityRank(a.severity) - severityRank(b.severity);
    if (severityDiff !== 0) return severityDiff;
    return String(a.category || '').localeCompare(String(b.category || ''));
  });

  const samples = sorted.slice(0, 14).map((issue) => ({
    category: issue.category || null,
    severity: issue.severity || null,
    title: issue.title || null,
    detail: issue.detail || issue.message || null,
    workflow_id: issue.workflow_id || null,
    pipeline_id: issue.pipeline_id || null,
    form_id: issue.form_id || null
  }));

  for (const issue of normalizeIssues(issues)) {
    const severity = normalizeSeverity(issue.severity);
    const category = String(issue.category || 'uncategorized');
    countsBySeverity[severity] = (countsBySeverity[severity] || 0) + 1;
    countsByCategory[category] = (countsByCategory[category] || 0) + 1;
  }

  const topCategories = Object.entries(countsByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => ({ category, count }));

  return {
    total: normalizeIssues(issues).length,
    by_severity: countsBySeverity,
    by_category: countsByCategory,
    top_categories: topCategories,
    samples
  };
}

function summarizeIssueBuckets(issues) {
  const buckets = new Map();

  for (const issue of normalizeIssues(issues)) {
    const category = String(issue.category || 'uncategorized');
    const severity = normalizeSeverity(issue.severity);
    const detail = normalizeIssueDetails([issue])[0];

    if (!buckets.has(category)) {
      buckets.set(category, {
        category,
        count: 0,
        by_severity: { high: 0, medium: 0, low: 0, info: 0 },
        samples: []
      });
    }

    const bucket = buckets.get(category);
    bucket.count += 1;
    bucket.by_severity[severity] = (bucket.by_severity[severity] || 0) + 1;

    if (bucket.samples.length < 5) {
      bucket.samples.push(detail);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

function normalizeIssueDetails(issues) {
  return normalizeIssues(issues).map((issue) => ({
    category: issue.category || null,
    severity: issue.severity || null,
    title: issue.title || null,
    detail: issue.detail || issue.message || null,
    workflow_id: issue.workflow_id || null,
    pipeline_id: issue.pipeline_id || null,
    form_id: issue.form_id || null
  }));
}

function generateHash(data) {
  return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
}

function buildMinimalSnapshot(snapshot) {
  return {
    counts: snapshot.counts || {
      contact_count: 0,
      company_count: 0,
      email_count: 0,
      pipeline_count: 0,
      workflow_count: 0,
      form_count: 0
    },
    included_sections: Array.isArray(snapshot.included_sections) ? snapshot.included_sections : [],
    usage: snapshot.usage || null,
    data_cleanliness: snapshot.data_cleanliness || null,
    capabilities: snapshot.capabilities || null
  };
}

function normalizeIssues(issues) {
  return Array.isArray(issues) ? issues.filter(Boolean) : [];
}

function normalizePromptMode(value) {
  return String(value || 'compact').toLowerCase() === 'full' ? 'full' : 'compact';
}

function deriveRelevantSections(issues, context = {}) {
  const sections = new Set();
  const objectType = String(context.objectType || '').toLowerCase();
  const objectLabel = String(context.objectLabel || '').toLowerCase();

  if (objectType === 'contacts' || objectLabel.includes('contact')) sections.add('contacts');
  if (objectType === 'companies' || objectLabel.includes('company')) sections.add('companies');
  if (objectType === 'deals' || objectLabel.includes('deal')) sections.add('deals');
  if (objectType === 'emails' || objectLabel.includes('email')) sections.add('emails');
  if (objectType === 'workflows' || objectLabel.includes('workflow')) sections.add('workflows');
  if (objectType === 'forms' || objectLabel.includes('form')) sections.add('forms');
  if (objectType === 'pipelines' || objectLabel.includes('pipeline')) sections.add('pipelines');
  if (objectType === 'owners' || objectLabel.includes('owner')) sections.add('usage');
  if (objectType === 'properties' || objectLabel.includes('propert')) sections.add('data_cleanliness');

  for (const issue of normalizeIssues(issues)) {
    const category = String(issue.category || '').toLowerCase();
    const objectTypeValue = String(issue.objectType || '').toLowerCase();
    const objectGroup = String(issue.objectGroup || '').toLowerCase();

    if (category === 'contacts' || objectTypeValue === 'contacts' || objectGroup === 'contacts') {
      sections.add('contacts');
    }
    if (category === 'companies' || objectTypeValue === 'companies' || objectGroup === 'companies') {
      sections.add('companies');
    }
    if (category === 'deals' || objectTypeValue === 'deals' || objectGroup === 'deals') {
      sections.add('deals');
    }
    if (category === 'emails' || objectTypeValue === 'emails') {
      sections.add('emails');
    }
    if (category === 'workflows' || objectTypeValue === 'workflows' || objectGroup === 'workflows') {
      sections.add('workflows');
    }
    if (category === 'forms' || objectTypeValue === 'forms') {
      sections.add('forms');
    }
    if (category === 'pipelines' || objectTypeValue === 'pipelines') {
      sections.add('pipelines');
    }
    if (category === 'usage' || objectTypeValue === 'owners' || objectGroup === 'owners') {
      sections.add('usage');
    }
    if (category === 'properties' || category === 'data_cleanliness') {
      sections.add('data_cleanliness');
    }
  }

  return sections;
}

function summarizeCapabilities(capabilities, relevantSections = new Set()) {
  if (!capabilities || typeof capabilities !== 'object') return null;

  const summary = {};

  for (const [key, value] of Object.entries(capabilities)) {
    if (value !== 'available' || relevantSections.has(key)) {
      summary[key] = value;
    }
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function normalizeSeverity(value) {
  const severity = String(value || 'low').toLowerCase();
  if (severity === 'high' || severity === 'medium' || severity === 'low') {
    return severity;
  }
  return 'low';
}

function severityRank(value) {
  const severity = normalizeSeverity(value);
  if (severity === 'high') return 0;
  if (severity === 'medium') return 1;
  return 2;
}

function normalizeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundRatio(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((normalizeNumber(numerator) / normalizeNumber(denominator)) * 100) / 100;
}

function isWorkflowActive(workflow) {
  const status = String(workflow && workflow.status ? workflow.status : '').toLowerCase();
  if (status) {
    return status === 'active';
  }

  return Boolean(workflow && (workflow.enabled || workflow.isEnabled)) && !workflow.archived;
}

function daysAgo(workflow) {
  const value =
    workflow && (workflow.last_triggered_days_ago || workflow.lastTriggeredDaysAgo || null);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

module.exports = {
  optimizeSnapshot,
  limitOptimizedSnapshotSize,
  buildAiFactsPayload,
  summarizeIssues,
  generateHash
};
