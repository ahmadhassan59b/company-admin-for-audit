function normalizePipeline(pipeline) {
  return {
    id: pipeline.id,
    label: pipeline.label,
    displayOrder: pipeline.displayOrder ?? null,
    stages: (pipeline.stages || []).map((stage) => ({
      id: stage.id,
      label: stage.label,
      displayOrder: stage.displayOrder ?? null,
      archived: Boolean(stage.archived)
    }))
  };
}

function normalizeWorkflow(workflow) {
  return {
    id: workflow.id || workflow.flowId,
    name: workflow.name || workflow.label || 'Untitled workflow',
    enabled: Boolean(workflow.isEnabled ?? workflow.enabled),
    type: workflow.type || workflow.flowType || null,
    lastTriggeredAt:
      workflow.lastTriggeredAt ||
      workflow.lastEnrollmentAt ||
      workflow.updatedAt ||
      null,
    updatedAt: workflow.updatedAt || null,
    archived: Boolean(workflow.archived)
  };
}

function normalizeForm(form) {
  return {
    id: form.id || form.guid,
    name: form.name || 'Untitled form',
    createdAt: form.createdAt || null,
    updatedAt: form.updatedAt || null,
    archived: Boolean(form.archived),
    formType: form.formType || null
  };
}

function normalizeProperty(property) {
  return {
    name: property.name,
    label: property.label,
    type: property.type,
    fieldType: property.fieldType,
    groupName: property.groupName || null,
    hubspotDefined: Boolean(property.hubspotDefined),
    hidden: Boolean(property.hidden),
    formField: Boolean(property.formField)
  };
}

function normalizeContact(contact) {
  return {
    id: contact.id,
    email: String(contact.email || '').trim(),
    firstname: String(contact.firstname || '').trim(),
    lastname: String(contact.lastname || '').trim(),
    lifecycleStage: String(contact.lifecycleStage || '').trim(),
    phone: String(contact.phone || '').trim(),
    jobTitle: String(contact.jobTitle || '').trim(),
    company: String(contact.company || '').trim(),
    ownerId: String(contact.ownerId || '').trim(),
    updatedAt: contact.updatedAt || null,
    archived: Boolean(contact.archived)
  };
}

function normalizeCompany(company) {
  return {
    id: company.id,
    name: String(company.name || '').trim(),
    domain: String(company.domain || '').trim(),
    website: String(company.website || '').trim(),
    phone: String(company.phone || '').trim(),
    industry: String(company.industry || '').trim(),
    employees: String(company.employees || '').trim(),
    country: String(company.country || '').trim(),
    annualRevenue: String(company.annualRevenue || '').trim(),
    ownerId: String(company.ownerId || '').trim(),
    updatedAt: company.updatedAt || null,
    archived: Boolean(company.archived)
  };
}

function normalizeEmail(email) {
  return {
    id: email.id,
    subject: String(email.subject || '').trim(),
    timestamp: String(email.timestamp || '').trim(),
    ownerId: String(email.ownerId || '').trim(),
    direction: String(email.direction || '').trim(),
    updatedAt: email.updatedAt || null,
    archived: Boolean(email.archived)
  };
}

function normalizeDeal(deal) {
  return {
    id: deal.id,
    name: String(deal.name || '').trim(),
    pipeline: String(deal.pipeline || '').trim(),
    stage: String(deal.stage || '').trim(),
    ownerId: String(deal.ownerId || '').trim(),
    associatedCompanyId: String(deal.associatedCompanyId || '').trim(),
    associatedCompanyIds: Array.isArray(deal.associatedCompanyIds) ? deal.associatedCompanyIds.map((value) => String(value).trim()).filter(Boolean) : [],
    closeDate: String(deal.closeDate || '').trim(),
    createdAt: String(deal.createdAt || '').trim(),
    amount: String(deal.amount || '').trim(),
    updatedAt: deal.updatedAt || null,
    archived: Boolean(deal.archived)
  };
}

function normalizeAuditInput(raw) {
  return {
    pipelines: raw.pipelines.map(normalizePipeline),
    workflows: raw.workflows.map(normalizeWorkflow),
    forms: raw.forms.map(normalizeForm),
    contacts: Array.isArray(raw.contacts) ? raw.contacts.map(normalizeContact) : [],
    companies: Array.isArray(raw.companies) ? raw.companies.map(normalizeCompany) : [],
    emails: Array.isArray(raw.emails) ? raw.emails.map(normalizeEmail) : [],
    deals: Array.isArray(raw.deals) ? raw.deals.map(normalizeDeal) : [],
    contactProperties: raw.contactProperties.map(normalizeProperty),
    dealProperties: raw.dealProperties.map(normalizeProperty)
  };
}

module.exports = {
  normalizeAuditInput
};
