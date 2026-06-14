const WORKFLOW_INACTIVE_DAYS = 30;
const DEAL_STALE_DAYS = 30;
const PIPELINE_STALE_RATIO = 0.3;
const PIPELINE_STAGE_LIMIT = 8;

function normalizeSeverity(severity) {
  const value = String(severity || 'low').toLowerCase();
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value;
  }
  return 'low';
}

function objectTypeForCategory(category) {
  const value = String(category || '').toLowerCase();
  if (value === 'deals') return 'deals';
  if (value === 'pipelines') return 'pipelines';
  if (value === 'workflows') return 'workflows';
  if (value === 'forms') return 'forms';
  if (value === 'usage') return 'owners';
  if (value === 'data_cleanliness') return 'properties';
  return 'properties';
}

function objectGroupForCategory(category, objectType) {
  const value = String(category || '').toLowerCase();
  if (value === 'deals' || objectType === 'deals') return 'deals';
  if (value === 'pipelines' || objectType === 'pipelines') return 'deals';
  if (value === 'data_cleanliness' || objectType === 'properties') return 'contacts';
  if (value === 'usage' || objectType === 'owners') return 'owners';
  return objectType;
}

function severityScore(severity) {
  const value = normalizeSeverity(severity);
  if (value === 'critical') return 15;
  if (value === 'high') return 8;
  if (value === 'medium') return 4;
  if (value === 'low') return 1;
  return 0;
}

function buildIssueId(category, message, meta) {
  const raw = [
    category,
    message,
    meta.workflow_id,
    meta.pipeline_id,
    meta.form_id,
    meta.deal_id
  ]
    .filter(Boolean)
    .join('-')
    .toLowerCase();

  return raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `issue-${Date.now()}`;
}

function defaultRecommendation(category, severity) {
  const normalized = String(category || '').toLowerCase();
  if (normalized === 'workflows') {
    return 'Review inactive workflows and keep only the automations that still support the funnel.';
  }
  if (normalized === 'pipelines') {
    return 'Trim stale deal motion and keep pipeline stages aligned to how reps actually sell.';
  }
  if (normalized === 'deals') {
    return 'Review deal hygiene so pipeline stage movement, ownership, and account matching stay reliable.';
  }
  if (normalized === 'forms') {
    return 'Retire low-usage forms and keep only the forms that still support active campaigns.';
  }
  if (normalized === 'usage') {
    return 'Review unused seats and align ownership with active users only.';
  }
  if (normalized === 'data_cleanliness') {
    return 'Consolidate duplicate properties and remove fields that no longer support reporting or automation.';
  }
  return severity === 'info'
    ? 'Review periodically to keep the workspace tidy.'
    : 'Review this area and remove unused configuration where possible.';
}

function defaultImpact(category, severity) {
  const normalized = String(category || '').toLowerCase();
  if (normalized === 'workflows') {
    return 'Automation gaps can slow lead response and lifecycle handoffs.';
  }
  if (normalized === 'pipelines') {
    return 'Deal movement can become harder to manage and forecast.';
  }
  if (normalized === 'deals') {
    return 'Missing deal fields weaken pipeline reporting, forecasting, and owner accountability.';
  }
  if (normalized === 'forms') {
    return 'Unused forms create clutter and can hide conversion issues.';
  }
  if (normalized === 'usage') {
    return 'Inactive seats can hide ownership gaps and reduce portal clarity.';
  }
  if (normalized === 'data_cleanliness') {
    return 'A large or messy property model makes reporting and automation harder to trust.';
  }
  return severity === 'info'
    ? 'This is informational and does not currently increase audit risk.'
    : 'This area should be reviewed to reduce configuration overhead.';
}

function addIssue(issues, category, severity, message, meta = {}) {
  const normalizedSeverity = normalizeSeverity(severity);
  const objectType = objectTypeForCategory(category);
  const issue = {
    id: meta.id || buildIssueId(category, message, meta),
    objectType,
    objectGroup: objectGroupForCategory(category, objectType),
    category,
    severity: normalizedSeverity,
    riskLevel: normalizedSeverity,
    severityScore: severityScore(normalizedSeverity),
    title: meta.title || message,
    description: meta.description || message,
    impact: meta.impact || defaultImpact(category, normalizedSeverity),
    recommendation: meta.recommendation || defaultRecommendation(category, normalizedSeverity),
    affectedCount:
      meta.affectedCount ||
      meta.unused_users ||
      meta.custom_properties ||
      meta.stale_deals ||
      meta.forms_without_submissions ||
      null,
    sampleRecords: Array.isArray(meta.sampleRecords) ? meta.sampleRecords : [],
    source: meta.source || 'rule_engine',
    message
  };

  Object.entries(meta || {}).forEach(([key, value]) => {
    if (typeof value !== 'undefined') {
      issue[key] = value;
    }
  });

  issues.push(issue);
}

function auditWorkflows(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.workflows === 'unavailable') {
    addIssue(
      issues,
      'workflows',
      'low',
      'Workflows could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  snapshot.workflows.forEach((workflow) => {
    if (workflow.status === 'inactive') {
      addIssue(
        issues,
        'workflows',
        'high',
        `Workflow '${workflow.name}' is inactive`,
        { workflow_id: workflow.id }
      );
    }

    if (
      workflow.last_triggered_days_ago !== null &&
      workflow.last_triggered_days_ago > WORKFLOW_INACTIVE_DAYS
    ) {
      addIssue(
        issues,
        'workflows',
        'medium',
        `Workflow '${workflow.name}' inactive for ${workflow.last_triggered_days_ago} days`,
        { workflow_id: workflow.id }
      );
    }
  });
}

function auditPipelines(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.pipelines === 'unavailable') {
    addIssue(
      issues,
      'pipelines',
      'low',
      'Deal pipelines could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  snapshot.pipelines.forEach((pipeline) => {
    const staleRatio =
      pipeline.deals_count > 0 ? pipeline.stale_deals / pipeline.deals_count : 0;

    if (staleRatio > PIPELINE_STALE_RATIO) {
      addIssue(
        issues,
        'pipelines',
        'high',
        `Pipeline '${pipeline.name}' has ${Math.round(staleRatio * 100)}% stale deals`,
        { pipeline_id: pipeline.id, stale_ratio: Number(staleRatio.toFixed(2)) }
      );
    }

    if (pipeline.stages > PIPELINE_STAGE_LIMIT) {
      addIssue(
        issues,
        'pipelines',
        'medium',
        `Pipeline '${pipeline.name}' has ${pipeline.stages} stages`,
        { pipeline_id: pipeline.id }
      );
    }
  });
}

function auditForms(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.forms === 'unavailable') {
    addIssue(
      issues,
      'forms',
      'low',
      'Forms could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  snapshot.forms.forEach((form) => {
    if (form.submissions_available && form.submissions_last_30_days === 0) {
      addIssue(
        issues,
        'forms',
        'medium',
        `Form '${form.name}' has zero submissions`,
        { form_id: form.id }
      );
    }
  });
}

function auditUsage(snapshot, issues) {
  if (snapshot.usage.status !== 'available') {
    addIssue(
      issues,
      'usage',
      'low',
      'CRM user usage could not be fetched with the current HubSpot scopes'
    );
    return;
  }

  const unusedUsers = snapshot.usage.total_users - snapshot.usage.active_users;

  if (unusedUsers > 0) {
    addIssue(
      issues,
      'usage',
      'medium',
      `${unusedUsers} HubSpot users appear inactive or unused`,
      { unused_users: unusedUsers }
    );
  }
}

function sampleRecords(records, fields = []) {
  return (Array.isArray(records) ? records : []).slice(0, 5).map((record) => {
    if (!fields.length) return record;
    return fields.reduce((acc, field) => {
      acc[field] = record && typeof record === 'object' ? record[field] ?? null : null;
      return acc;
    }, {});
  });
}

function auditContacts(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.contacts === 'unavailable') {
    addIssue(
      issues,
      'contacts',
      'low',
      'Contacts could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
  if (contacts.length === 0) return;

  const missingEmail = contacts.filter((contact) => !String(contact.email || '').trim());
  if (missingEmail.length > 0) {
    addIssue(issues, 'contacts', missingEmail.length >= 100 ? 'high' : 'medium', 'Contacts missing email address', {
      title: 'Contacts missing email address',
      description: `${missingEmail.length} contact record${missingEmail.length === 1 ? '' : 's'} do not have an email address.`,
      impact: 'These contacts cannot be used reliably for email marketing, automation, or deduplication.',
      recommendation: 'Review these records and either enrich them with valid email addresses or exclude them from email workflows.',
      affectedCount: missingEmail.length,
      sampleRecords: sampleRecords(missingEmail, ['id', 'email', 'firstname', 'lastname']),
      contact_ids: missingEmail.slice(0, 5).map((contact) => contact.id).filter(Boolean)
    });
  }

  const missingName = contacts.filter(
    (contact) => !String(contact.firstname || '').trim() && !String(contact.lastname || '').trim()
  );
  if (missingName.length > 0) {
    addIssue(issues, 'contacts', missingName.length >= 250 ? 'high' : 'medium', 'Contacts missing name details', {
      title: 'Contacts missing name details',
      description: `${missingName.length} contact record${missingName.length === 1 ? '' : 's'} do not have a first or last name.`,
      impact: 'Missing names make contact records harder to review, deduplicate, and assign to the right owners.',
      recommendation: 'Backfill names from import history, source systems, or related deal data where possible.',
      affectedCount: missingName.length,
      sampleRecords: sampleRecords(missingName, ['id', 'firstname', 'lastname', 'email']),
      contact_ids: missingName.slice(0, 5).map((contact) => contact.id).filter(Boolean)
    });
  }

  const missingLifecycle = contacts.filter((contact) => !String(contact.lifecycleStage || '').trim());
  if (missingLifecycle.length > 0) {
    addIssue(issues, 'contacts', missingLifecycle.length >= 150 ? 'high' : 'medium', 'Contacts missing lifecycle stage', {
      title: 'Contacts missing lifecycle stage',
      description: `${missingLifecycle.length} contact record${missingLifecycle.length === 1 ? '' : 's'} do not have a lifecycle stage.`,
      impact: 'Lifecycle stage gaps make segmentation, automation, and reporting unreliable.',
      recommendation: 'Backfill lifecycle stages using source, deal history, or form conversion data.',
      affectedCount: missingLifecycle.length,
      sampleRecords: sampleRecords(missingLifecycle, ['id', 'firstname', 'lastname', 'email', 'lifecycleStage']),
      contact_ids: missingLifecycle.slice(0, 5).map((contact) => contact.id).filter(Boolean)
    });
  }
}

function auditCompanies(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.companies === 'unavailable') {
    addIssue(
      issues,
      'companies',
      'low',
      'Companies could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  const companies = Array.isArray(snapshot.companies) ? snapshot.companies : [];
  if (companies.length === 0) return;

  const missingName = companies.filter((company) => !String(company.name || '').trim());
  if (missingName.length > 0) {
    addIssue(issues, 'companies', missingName.length >= 100 ? 'high' : 'medium', 'Companies missing company name', {
      title: 'Companies missing company name',
      description: `${missingName.length} company record${missingName.length === 1 ? '' : 's'} do not have a company name.`,
      impact: 'Missing company names make account ownership and reporting harder to trust.',
      recommendation: 'Review these records and backfill company names from source systems or related domains.',
      affectedCount: missingName.length,
      sampleRecords: sampleRecords(missingName, ['id', 'name', 'domain', 'website']),
      company_ids: missingName.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingDomain = companies.filter(
    (company) => !String(company.domain || '').trim() && !String(company.website || '').trim()
  );
  if (missingDomain.length > 0) {
    addIssue(issues, 'companies', missingDomain.length >= 150 ? 'medium' : 'low', 'Companies missing domain or website', {
      title: 'Companies missing domain or website',
      description: `${missingDomain.length} company record${missingDomain.length === 1 ? '' : 's'} do not have a domain or website.`,
      impact: 'Missing domain data makes account matching, deduplication, and enrichment less reliable.',
      recommendation: 'Review these company records and add a website or domain where possible.',
      affectedCount: missingDomain.length,
      sampleRecords: sampleRecords(missingDomain, ['id', 'name', 'domain', 'website']),
      company_ids: missingDomain.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingPhone = companies.filter((company) => !String(company.phone || '').trim());
  if (missingPhone.length > 0) {
    addIssue(issues, 'companies', missingPhone.length >= 150 ? 'medium' : 'low', 'Companies missing phone numbers', {
      title: 'Companies missing phone numbers',
      description: `${missingPhone.length} company record${missingPhone.length === 1 ? '' : 's'} do not have a phone number.`,
      impact: 'Missing phone data weakens account enrichment and contactability.',
      recommendation: 'Backfill company phone numbers where available from source records or enrichment data.',
      affectedCount: missingPhone.length,
      sampleRecords: sampleRecords(missingPhone, ['id', 'name', 'phone', 'domain']),
      company_ids: missingPhone.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingOwner = companies.filter((company) => !String(company.ownerId || '').trim());
  if (missingOwner.length > 0) {
    addIssue(issues, 'companies', missingOwner.length >= 150 ? 'high' : 'medium', 'Companies missing owner assignment', {
      title: 'Companies missing owner assignment',
      description: `${missingOwner.length} company record${missingOwner.length === 1 ? '' : 's'} do not have an owner assigned.`,
      impact: 'Unowned companies reduce accountability and make follow-up harder to track.',
      recommendation: 'Assign owners to company records so account management stays accountable.',
      affectedCount: missingOwner.length,
      sampleRecords: sampleRecords(missingOwner, ['id', 'name', 'ownerId', 'domain']),
      company_ids: missingOwner.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingIndustry = companies.filter((company) => !String(company.industry || '').trim());
  if (missingIndustry.length > 0) {
    addIssue(issues, 'companies', missingIndustry.length >= 150 ? 'low' : 'info', 'Companies missing industry', {
      title: 'Companies missing industry',
      description: `${missingIndustry.length} company record${missingIndustry.length === 1 ? '' : 's'} do not have an industry value.`,
      impact: 'Missing industry values make segmentation and account scoring less consistent.',
      recommendation: 'Backfill industry values where possible to improve reporting and routing.',
      affectedCount: missingIndustry.length,
      sampleRecords: sampleRecords(missingIndustry, ['id', 'name', 'industry', 'domain']),
      company_ids: missingIndustry.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingEmployees = companies.filter((company) => !String(company.employees || '').trim());
  if (missingEmployees.length > 0) {
    addIssue(issues, 'companies', missingEmployees.length >= 150 ? 'low' : 'info', 'Companies missing employee count', {
      title: 'Companies missing employee count',
      description: `${missingEmployees.length} company record${missingEmployees.length === 1 ? '' : 's'} do not have an employee count.`,
      impact: 'Missing employee count weakens account sizing and segmentation.',
      recommendation: 'Backfill employee counts where possible from enrichment data or external sources.',
      affectedCount: missingEmployees.length,
      sampleRecords: sampleRecords(missingEmployees, ['id', 'name', 'employees', 'domain']),
      company_ids: missingEmployees.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingCountry = companies.filter((company) => !String(company.country || '').trim());
  if (missingCountry.length > 0) {
    addIssue(issues, 'companies', missingCountry.length >= 150 ? 'low' : 'info', 'Companies missing country', {
      title: 'Companies missing country',
      description: `${missingCountry.length} company record${missingCountry.length === 1 ? '' : 's'} do not have a country value.`,
      impact: 'Missing country values reduce reporting consistency across regions.',
      recommendation: 'Backfill country values to improve regional reporting and routing.',
      affectedCount: missingCountry.length,
      sampleRecords: sampleRecords(missingCountry, ['id', 'name', 'country', 'domain']),
      company_ids: missingCountry.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }

  const missingRevenue = companies.filter((company) => !String(company.annualRevenue || '').trim());
  if (missingRevenue.length > 0) {
    addIssue(issues, 'companies', missingRevenue.length >= 150 ? 'info' : 'low', 'Companies missing annual revenue', {
      title: 'Companies missing annual revenue',
      description: `${missingRevenue.length} company record${missingRevenue.length === 1 ? '' : 's'} do not have annual revenue.`,
      impact: 'Missing revenue data limits account scoring and prioritization.',
      recommendation: 'Backfill annual revenue where available to support scoring and segmentation.',
      affectedCount: missingRevenue.length,
      sampleRecords: sampleRecords(missingRevenue, ['id', 'name', 'annualRevenue', 'domain']),
      company_ids: missingRevenue.slice(0, 5).map((company) => company.id).filter(Boolean)
    });
  }
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function auditDeals(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.deals === 'unavailable') {
    addIssue(
      issues,
      'deals',
      'low',
      'Deals could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  const deals = Array.isArray(snapshot.deals) ? snapshot.deals : [];
  if (deals.length === 0) return;

  const staleCutoff = Date.now() - DEAL_STALE_DAYS * 24 * 60 * 60 * 1000;

  const missingName = deals.filter((deal) => !String(deal.name || '').trim());
  if (missingName.length > 0) {
    addIssue(issues, 'deals', missingName.length >= 100 ? 'high' : 'medium', 'Deals missing deal name', {
      title: 'Deals missing deal name',
      description: `${missingName.length} deal record${missingName.length === 1 ? '' : 's'} do not have a deal name.`,
      impact: 'Missing deal names make pipeline review, ownership, and forecasting harder to trust.',
      recommendation: 'Backfill deal names from the source CRM or related opportunity records.',
      affectedCount: missingName.length,
      sampleRecords: sampleRecords(missingName, ['id', 'name', 'pipeline', 'stage']),
      deal_ids: missingName.slice(0, 5).map((deal) => deal.id).filter(Boolean)
    });
  }

  const missingPipeline = deals.filter((deal) => !String(deal.pipeline || '').trim());
  if (missingPipeline.length > 0) {
    addIssue(issues, 'deals', missingPipeline.length >= 100 ? 'high' : 'medium', 'Deals missing pipeline assignment', {
      title: 'Deals missing pipeline assignment',
      description: `${missingPipeline.length} deal record${missingPipeline.length === 1 ? '' : 's'} do not have a pipeline assigned.`,
      impact: 'Unassigned deals weaken forecasting and make pipeline reporting inconsistent.',
      recommendation: 'Assign each deal to the correct pipeline so stages and reporting stay accurate.',
      affectedCount: missingPipeline.length,
      sampleRecords: sampleRecords(missingPipeline, ['id', 'name', 'pipeline', 'stage']),
      deal_ids: missingPipeline.slice(0, 5).map((deal) => deal.id).filter(Boolean)
    });
  }

  const missingStage = deals.filter((deal) => !String(deal.stage || '').trim());
  if (missingStage.length > 0) {
    addIssue(issues, 'deals', missingStage.length >= 100 ? 'high' : 'medium', 'Deals missing stage assignment', {
      title: 'Deals missing stage assignment',
      description: `${missingStage.length} deal record${missingStage.length === 1 ? '' : 's'} do not have a stage assigned.`,
      impact: 'Missing deal stages make forecasting, ownership, and deal motion harder to manage.',
      recommendation: 'Place each deal into an appropriate stage so funnel movement stays reliable.',
      affectedCount: missingStage.length,
      sampleRecords: sampleRecords(missingStage, ['id', 'name', 'pipeline', 'stage']),
      deal_ids: missingStage.slice(0, 5).map((deal) => deal.id).filter(Boolean)
    });
  }

  const missingOwner = deals.filter((deal) => !String(deal.ownerId || '').trim());
  if (missingOwner.length > 0) {
    addIssue(issues, 'deals', missingOwner.length >= 100 ? 'high' : 'medium', 'Deals missing owner assignment', {
      title: 'Deals missing owner assignment',
      description: `${missingOwner.length} deal record${missingOwner.length === 1 ? '' : 's'} do not have an owner assigned.`,
      impact: 'Deals without owners weaken accountability and stall follow-up.',
      recommendation: 'Assign owners to deal records so pipeline ownership stays clear.',
      affectedCount: missingOwner.length,
      sampleRecords: sampleRecords(missingOwner, ['id', 'name', 'ownerId', 'pipeline']),
      deal_ids: missingOwner.slice(0, 5).map((deal) => deal.id).filter(Boolean)
    });
  }

  const missingCompany = deals.filter((deal) => !String(deal.associatedCompanyId || '').trim() && (!Array.isArray(deal.associatedCompanyIds) || deal.associatedCompanyIds.length === 0));
  if (missingCompany.length > 0) {
    addIssue(issues, 'deals', missingCompany.length >= 100 ? 'medium' : 'low', 'Deals missing associated company', {
      title: 'Deals missing associated company',
      description: `${missingCompany.length} deal record${missingCompany.length === 1 ? '' : 's'} are not associated with a company.`,
      impact: 'Missing company links weaken account-level reporting and forecast context.',
      recommendation: 'Associate each deal with the correct company where possible.',
      affectedCount: missingCompany.length,
      sampleRecords: sampleRecords(missingCompany, ['id', 'name', 'associatedCompanyId', 'pipeline']),
      deal_ids: missingCompany.slice(0, 5).map((deal) => deal.id).filter(Boolean)
    });
  }

  const staleDeals = deals.filter((deal) => {
    const updatedAt = parseTimestamp(deal.updatedAt);
    return updatedAt !== null && updatedAt < staleCutoff;
  });
  if (staleDeals.length > 0) {
    addIssue(issues, 'deals', staleDeals.length >= 100 ? 'medium' : 'low', 'Stale deals older than 30 days', {
      title: 'Stale deals older than 30 days',
      description: `${staleDeals.length} deal record${staleDeals.length === 1 ? '' : 's'} have not been updated in over 30 days.`,
      impact: 'Stale deals can hide forecast risk and slow down pipeline motion.',
      recommendation: 'Review stale deals, confirm ownership, and update next steps or close them out.',
      affectedCount: staleDeals.length,
      sampleRecords: sampleRecords(staleDeals, ['id', 'name', 'pipeline', 'stage', 'updatedAt']),
      deal_ids: staleDeals.slice(0, 5).map((deal) => deal.id).filter(Boolean)
    });
  }
}

function auditEmails(snapshot, issues) {
  if (snapshot.capabilities && snapshot.capabilities.emails === 'unavailable') {
    addIssue(
      issues,
      'emails',
      'low',
      'Emails could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  const emails = Array.isArray(snapshot.emails) ? snapshot.emails : [];
  if (emails.length === 0) return;

  const missingSubject = emails.filter((email) => !String(email.subject || '').trim());
  if (missingSubject.length > 0) {
    addIssue(issues, 'emails', missingSubject.length >= 100 ? 'medium' : 'low', 'Emails missing subject lines', {
      title: 'Emails missing subject lines',
      description: `${missingSubject.length} email record${missingSubject.length === 1 ? '' : 's'} do not have a subject line.`,
      impact: 'Missing subjects weaken reporting, search, and conversation review.',
      recommendation: 'Backfill subjects where possible or remove incomplete email activity records from analysis.',
      affectedCount: missingSubject.length,
      sampleRecords: sampleRecords(missingSubject, ['id', 'subject', 'timestamp', 'ownerId']),
      email_ids: missingSubject.slice(0, 5).map((email) => email.id).filter(Boolean)
    });
  }

  const missingTimestamp = emails.filter((email) => !String(email.timestamp || '').trim());
  if (missingTimestamp.length > 0) {
    addIssue(issues, 'emails', missingTimestamp.length >= 100 ? 'medium' : 'low', 'Emails missing timestamps', {
      title: 'Emails missing timestamps',
      description: `${missingTimestamp.length} email record${missingTimestamp.length === 1 ? '' : 's'} do not have a timestamp.`,
      impact: 'Missing timestamps make it harder to trust sequencing and engagement reporting.',
      recommendation: 'Ensure email activity is captured with source timestamps before using it in reporting.',
      affectedCount: missingTimestamp.length,
      sampleRecords: sampleRecords(missingTimestamp, ['id', 'subject', 'timestamp', 'ownerId']),
      email_ids: missingTimestamp.slice(0, 5).map((email) => email.id).filter(Boolean)
    });
  }
}

function auditDataCleanliness(snapshot, issues) {
  if (snapshot.data_cleanliness.status !== 'available') {
    addIssue(
      issues,
      'data_cleanliness',
      'low',
      'CRM properties could not be fetched with the current HubSpot permissions'
    );
    return;
  }

  const customProperties =
    snapshot.data_cleanliness.custom_contact_properties +
    snapshot.data_cleanliness.custom_deal_properties;

  if (customProperties > 250) {
    addIssue(
      issues,
      'data_cleanliness',
      'medium',
      `${customProperties} custom CRM properties may indicate data model complexity`,
      { custom_properties: customProperties }
    );
  }
}

function runAuditRules(snapshot) {
  const issues = [];

  auditContacts(snapshot, issues);
  auditCompanies(snapshot, issues);
  auditDeals(snapshot, issues);
  auditEmails(snapshot, issues);
  auditWorkflows(snapshot, issues);
  auditPipelines(snapshot, issues);
  auditForms(snapshot, issues);
  auditUsage(snapshot, issues);
  auditDataCleanliness(snapshot, issues);

  return {
    issues,
    issue_count: issues.length,
    by_category: issues.reduce((counts, issue) => {
      counts[issue.category] = (counts[issue.category] || 0) + 1;
      return counts;
    }, {})
  };
}

module.exports = {
  runAuditRules
};
