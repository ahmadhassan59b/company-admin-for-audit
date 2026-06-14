const db = require('../../config/db');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const pipelinesService = require('../hubspot/pipelines.service');
const workflowsService = require('../hubspot/workflows.service');
const formsService = require('../hubspot/forms.service');
const contactsService = require('../hubspot/contacts.service');
const companiesService = require('../hubspot/companies.service');
const emailsService = require('../hubspot/emails.service');
const dealsService = require('../hubspot/deals.service');
const propertiesService = require('../hubspot/properties.service');
const { normalizeAuditInput } = require('./normalize.service');
const { calculateHealthScore } = require('./score.service');
const { buildAuditSnapshot } = require('./snapshot.service');
const { runAuditRules } = require('./rules.service');
const { calculateScore } = require('./phase1-score.service');
const { estimateWaste } = require('./waste.service');
const { generateAuditReport } = require('./report.service');
const tokenService = require('../hubspot/token.service');
const hubspotAccountService = require('../hubspot/account.service');
const {
  analyzeAudit,
  isAiEnabled,
  isOllamaEnabled,
  isOpenRouterEnabled,
  buildNoIssueAiResult
} = require('../../ai');
const { calculateAiScore } = require('../../ai/ai-score.service');
const { AppError } = require('../../utils/errors');
const { safeCall } = require('../../utils/httpClient');
const {
  buildAiFactsPayload,
  generateHash
} = require('./snapshotOptimizer');
const auditCacheService = require('./auditCache.service');
const {
  calculateAiCostEstimate,
  recordAuditCost
} = require('./cost.service');
const aiQueue = require('./aiQueue.service');

const STALE_FORM_DAYS = 180;
const CUSTOM_CONTACT_PROPERTY_THRESHOLD = 75;
const CUSTOM_DEAL_PROPERTY_THRESHOLD = 50;
const AI_MODES = new Set(['compact', 'full']);
const OBJECT_AI_TYPES = ['contacts', 'companies', 'deals', 'emails', 'workflows', 'forms'];
const DETAIL_SECTION_KEYS = new Set(['pipeline', 'automation', 'feature']);
const DEFAULT_AI_MAX_INPUT_CHARS = Number.isFinite(Number(env.aiMaxInputChars))
  ? Number(env.aiMaxInputChars)
  : 8000;

function normalizePromptMode(value) {
  return String(value || env.aiPromptMode || 'compact').toLowerCase() === 'full' ? 'full' : 'compact';
}

function normalizeDetailSection(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pipeline' || normalized === 'pipelines' || normalized === 'deals') return 'pipeline';
  if (normalized === 'automation' || normalized === 'workflow' || normalized === 'workflows') return 'automation';
  if (
    normalized === 'feature' ||
    normalized === 'features' ||
    normalized === 'forms' ||
    normalized === 'usage' ||
    normalized === 'properties'
  ) {
    return 'feature';
  }
  return null;
}

function aiJobKey(auditId, mode, objectType = null) {
  const normalizedObjectType = normalizeAiObjectType(objectType);
  return `${Number(auditId)}:${normalizePromptMode(mode)}:${normalizedObjectType || 'all'}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeIssuesForAi(issues) {
  return Array.isArray(issues) ? issues.filter(Boolean) : [];
}

function normalizeAuditScope(scope) {
  const values = Array.isArray(scope)
    ? scope
    : String(scope || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

  const normalized = values
    .map((value) => String(value).toLowerCase())
    .filter(Boolean);

  if (!normalized.length || normalized.includes('full') || normalized.includes('all')) {
    return ['full'];
  }

  return Array.from(new Set(normalized));
}

function normalizeGrantedScopes(scopes) {
  if (Array.isArray(scopes)) {
    return new Set(
      scopes
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    );
  }

  const raw = String(scopes || '').trim();
  if (!raw) {
    return new Set();
  }

  const normalizedText = raw
    .replace(/^[{[]|[}\]]$/g, '')
    .replace(/['"]/g, '')
    .replace(/,/g, ' ');

  return new Set(
    normalizedText
      .split(/\s+/)
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function hasGrantedScopes(grantedScopes, requiredScopes) {
  const list = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
  return list.every((scope) => grantedScopes.has(String(scope || '').trim().toLowerCase()));
}

function isScopeActive(scopeSet, key) {
  if (!scopeSet || !scopeSet.size || scopeSet.has('full') || scopeSet.has('all')) {
    return true;
  }

  const normalizedKey = String(key || '').toLowerCase();
  if (!normalizedKey) return false;

  if (scopeSet.has(normalizedKey)) return true;
  if (normalizedKey === 'pipelines' && scopeSet.has('deals')) return true;
  if (normalizedKey === 'deals' && scopeSet.has('pipelines')) return true;
  if (normalizedKey === 'contacts' && scopeSet.has('contacts')) return true;
  if (normalizedKey === 'companies' && scopeSet.has('companies')) return true;
  if (normalizedKey === 'emails' && scopeSet.has('emails')) return true;
  if (normalizedKey === 'properties' && (scopeSet.has('contacts') || scopeSet.has('properties'))) return true;
  return false;
}

function buildAuditScope(client, tenantId) {
  const effectiveTenantId = tenantId || client?.tenant_id || null;

  if (effectiveTenantId) {
    return `tenant:${effectiveTenantId}`;
  }

  return `client:${client.internal_account_key}`;
}

async function reserveAuditNumber(scope) {
  const result = await db.query(
    `
      INSERT INTO audit_number_counters (scope, last_number, updated_at)
      VALUES ($1, 1, NOW())
      ON CONFLICT (scope)
      DO UPDATE SET
        last_number = audit_number_counters.last_number + 1,
        updated_at = NOW()
      RETURNING last_number
    `,
    [scope]
  );

  return result.rows[0].last_number;
}

function getAiVariants(reportJson) {
  const variants = reportJson && typeof reportJson === 'object' ? reportJson.ai_variants : null;
  return variants && typeof variants === 'object' ? variants : {};
}

function getAiJobs(reportJson) {
  const jobs = reportJson && typeof reportJson === 'object' ? reportJson.ai_jobs : null;
  return jobs && typeof jobs === 'object' ? jobs : {};
}

function getObjectAiVariants(reportJson) {
  const variants = reportJson && typeof reportJson === 'object' ? reportJson.ai_object_variants : null;
  return variants && typeof variants === 'object' ? variants : {};
}

function getObjectAiJobs(reportJson) {
  const jobs = reportJson && typeof reportJson === 'object' ? reportJson.ai_object_jobs : null;
  return jobs && typeof jobs === 'object' ? jobs : {};
}

function getObjectAiErrors(reportJson) {
  const errors = reportJson && typeof reportJson === 'object' ? reportJson.ai_object_errors : null;
  return errors && typeof errors === 'object' ? errors : {};
}

function normalizeAiSectionSummaries(sectionSummaries) {
  if (!sectionSummaries || typeof sectionSummaries !== 'object' || Array.isArray(sectionSummaries)) {
    return {};
  }

  return Object.entries(sectionSummaries).reduce((acc, [sectionType, summary]) => {
    const normalizedSectionType = String(sectionType || '').trim().toLowerCase();
    if (!normalizedSectionType || !summary || typeof summary !== 'object') {
      return acc;
    }

    acc[normalizedSectionType] = summary;
    return acc;
  }, {});
}

function normalizeAiObjectType(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'contacts' || normalized === 'companies' || normalized === 'deals' || normalized === 'emails' || normalized === 'workflows' || normalized === 'forms' || normalized === 'pipelines') {
    return normalized === 'pipelines' ? 'deals' : normalized;
  }
  return null;
}

function resolveObjectAiTypes(scope) {
  const scopeSet = new Set(normalizeAuditScope(scope));
  return OBJECT_AI_TYPES.filter((objectType) => isScopeActive(scopeSet, objectType));
}

function objectAiLabel(objectType) {
  const normalized = normalizeAiObjectType(objectType);
  if (!normalized) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function issueMatchesObjectType(issue, objectType) {
  const normalizedObjectType = normalizeAiObjectType(objectType);
  if (!normalizedObjectType) return true;

  const issueType = String(issue && (issue.objectType || issue.object_type || '')).toLowerCase();
  const issueGroup = String(issue && (issue.objectGroup || issue.object_group || '')).toLowerCase();
  const category = String(issue && issue.category || '').toLowerCase();

  if (issueType === normalizedObjectType || issueGroup === normalizedObjectType || category === normalizedObjectType) {
    return true;
  }

  if (normalizedObjectType === 'deals' && (issueType === 'pipelines' || issueGroup === 'deals' || category === 'pipelines')) {
    return true;
  }

  if (normalizedObjectType === 'contacts' && (issueType === 'properties' || issueGroup === 'contacts' || category === 'data_cleanliness')) {
    return true;
  }

  if (normalizedObjectType === 'companies' && (issueType === 'properties' || issueGroup === 'companies' || category === 'companies')) {
    return true;
  }

  if (normalizedObjectType === 'emails' && (issueType === 'properties' || issueGroup === 'emails' || category === 'emails')) {
    return true;
  }

  return false;
}

function getAiVariant(reportJson, mode, objectType = null) {
  const normalized = normalizePromptMode(mode);
  const normalizedObjectType = normalizeAiObjectType(objectType);

  if (normalizedObjectType) {
    const objectVariants = getObjectAiVariants(reportJson);
    const scopedVariants = objectVariants[normalizedObjectType] && typeof objectVariants[normalizedObjectType] === 'object'
      ? objectVariants[normalizedObjectType]
      : {};

    if (scopedVariants[normalized]) return scopedVariants[normalized];
  }

  const variants = getAiVariants(reportJson);
  if (variants[normalized]) return variants[normalized];
  if (normalized === 'compact' && reportJson && reportJson.ai && reportJson.ai_prompt_mode !== 'full') {
    return reportJson.ai;
  }
  if (normalized === 'full' && reportJson && reportJson.ai && reportJson.ai_prompt_mode === 'full') {
    return reportJson.ai;
  }
  return null;
}

function getStoredFullAi(reportJson) {
  if (reportJson && typeof reportJson === 'object' && reportJson.ai && typeof reportJson.ai === 'object') {
    return reportJson.ai;
  }

  const variants = getAiVariants(reportJson);
  if (variants.full && typeof variants.full === 'object') {
    return variants.full;
  }

  return null;
}

function getAiJob(reportJson, mode, objectType = null) {
  const normalized = normalizePromptMode(mode);
  const normalizedObjectType = normalizeAiObjectType(objectType);

  if (normalizedObjectType) {
    const objectJobs = getObjectAiJobs(reportJson);
    const scopedJobs = objectJobs[normalizedObjectType] && typeof objectJobs[normalizedObjectType] === 'object'
      ? objectJobs[normalizedObjectType]
      : {};
    const objectJob = scopedJobs[normalized];
    if (objectJob && typeof objectJob === 'object') return objectJob;
  }

  const jobs = getAiJobs(reportJson);
  const job = jobs[normalized];
  return job && typeof job === 'object' ? job : null;
}

function getAiError(reportJson, mode, objectType = null) {
  const normalized = normalizePromptMode(mode);
  const normalizedObjectType = normalizeAiObjectType(objectType);

  if (normalizedObjectType) {
    const objectErrors = getObjectAiErrors(reportJson);
    const scopedErrors = objectErrors[normalizedObjectType] && typeof objectErrors[normalizedObjectType] === 'object'
      ? objectErrors[normalizedObjectType]
      : {};
    const objectError = scopedErrors[normalized];
    if (objectError && typeof objectError === 'object') return objectError;
  }

  return reportJson && typeof reportJson === 'object' ? reportJson.ai_error || null : null;
}

function getCurrentAiMode(reportJson) {
  return normalizePromptMode(reportJson && reportJson.ai_prompt_mode);
}

function buildAiReportState(reportJson, mode, patch) {
  const normalized = normalizePromptMode(mode);
  const normalizedObjectType = normalizeAiObjectType(patch.objectType);
  const next = {
    ...(reportJson || {})
  };

  if (normalizedObjectType) {
    const objectVariants = getObjectAiVariants(reportJson);
    const objectJobs = getObjectAiJobs(reportJson);
    const objectErrors = getObjectAiErrors(reportJson);
    const nextObjectErrorBucket = {
      ...(objectErrors[normalizedObjectType] || {})
    };
    if (patch.ai_error) {
      nextObjectErrorBucket[normalized] = patch.ai_error;
    } else if (patch.clear_ai_error || patch.ai) {
      delete nextObjectErrorBucket[normalized];
    }
    next.ai_object_variants = {
      ...objectVariants,
      [normalizedObjectType]: {
        ...(objectVariants[normalizedObjectType] || {}),
        ...(patch.ai ? { [normalized]: patch.ai } : {})
      }
    };
    next.ai_object_jobs = {
      ...objectJobs,
      [normalizedObjectType]: {
        ...(objectJobs[normalizedObjectType] || {}),
        [normalized]: {
          ...((objectJobs[normalizedObjectType] && objectJobs[normalizedObjectType][normalized]) || {}),
          ...(patch.ai_status ? { status: patch.ai_status } : {}),
          ...(patch.started_at ? { started_at: patch.started_at } : {}),
          ...(patch.completed_at ? { completed_at: patch.completed_at } : {}),
          ...(patch.error ? { error: patch.error } : {}),
          ...(patch.cached !== undefined ? { cached: Boolean(patch.cached) } : {}),
          ...(patch.skipped !== undefined ? { skipped: Boolean(patch.skipped) } : {})
        }
      }
    };
    next.ai_object_errors = {
      ...objectErrors,
      [normalizedObjectType]: {
        ...nextObjectErrorBucket
      }
    };
  } else {
    next.ai_variants = {
      ...getAiVariants(reportJson),
      ...(patch.ai ? { [normalized]: patch.ai } : {})
    };
    next.ai_jobs = {
      ...getAiJobs(reportJson),
      [normalized]: {
        ...(getAiJob(reportJson, normalized) || {}),
        ...(patch.ai_status ? { status: patch.ai_status } : {}),
        ...(patch.started_at ? { started_at: patch.started_at } : {}),
        ...(patch.completed_at ? { completed_at: patch.completed_at } : {}),
        ...(patch.error ? { error: patch.error } : {}),
        ...(patch.cached !== undefined ? { cached: Boolean(patch.cached) } : {}),
        ...(patch.skipped !== undefined ? { skipped: Boolean(patch.skipped) } : {})
      }
    };
  }

  if (!normalizedObjectType) {
    if (patch.ai_error) {
      next.ai_error = patch.ai_error;
    } else if (patch.clear_ai_error) {
      delete next.ai_error;
    }

    if (patch.ai_metrics) {
      next.ai_metrics = patch.ai_metrics;
    } else if (patch.clear_ai_metrics) {
      delete next.ai_metrics;
    }
  }

  if (patch.ai) {
    if (!normalizedObjectType) {
      next.ai = patch.ai;
      next.ai_score = patch.ai_score;
      next.ai_prompt_mode = normalized;
    }
  } else if (patch.ai_status && normalized && !normalizedObjectType) {
    next.ai_prompt_mode = normalized;
  }

  const sectionSummaries = patch.ai ? normalizeAiSectionSummaries(patch.ai.section_summaries || patch.ai.sectionSummaries || null) : {};
  if (Object.keys(sectionSummaries).length > 0) {
    const objectVariants = {
      ...(getObjectAiVariants(next.ai_object_variants ? next : reportJson))
    };

    for (const [sectionType, sectionAi] of Object.entries(sectionSummaries)) {
      if (!sectionAi || typeof sectionAi !== 'object') continue;
      objectVariants[sectionType] = {
        ...(objectVariants[sectionType] || {}),
        [normalized]: sectionAi
      };
    }

    next.ai_object_variants = objectVariants;
  }

  if (normalizedObjectType) {
    next.ai_object_type = normalizedObjectType;
    next.ai_object_prompt_mode = normalized;
  }

  return next;
}

async function resolveOptimizedAiAnalysis(snapshot, issues, aiPromptMode, context = {}) {
  const safeIssues = normalizeIssuesForAi(issues);
  const normalizedMode = normalizePromptMode(aiPromptMode);
  const normalizedObjectType = normalizeAiObjectType(context.aiObjectType);
  const factsPayload = buildAiFactsPayload(
    snapshot,
    safeIssues,
    normalizedMode,
    DEFAULT_AI_MAX_INPUT_CHARS,
    {
      objectType: normalizedObjectType,
      objectLabel: context.aiObjectLabel || normalizedObjectType || null
    }
  );
  const inputChars = JSON.stringify(factsPayload).length;

  if (safeIssues.length === 0) {
    logger.info('AI analysis skipped because no issues were found', {
      auditId: context.auditId || null,
      mode: normalizedMode,
      objectType: normalizedObjectType || null
    });

    return {
      ai: buildNoIssueAiResult(snapshot, {
        objectType: normalizedObjectType,
        objectLabel: context.aiObjectLabel || normalizedObjectType || null
      }),
      ai_prompt_mode: normalizedMode,
      cached: true,
      skipped: true,
      cache_key: null,
      metrics: {
        input_chars: 0,
        output_chars: 0,
        cache_hit: true,
        ai_cost: 0,
        total_cost: 0
      }
    };
  }

  const cacheKey = generateHash({
    prompt_mode: normalizedMode,
    object_type: normalizedObjectType,
    facts: factsPayload
  });

  const cachedAi = await safeCall(
    () => auditCacheService.getCachedAiResult(cacheKey),
    null,
    (error) => {
      logger.warn('AI cache lookup failed, continuing without cache', {
        auditId: context.auditId || null,
        mode: normalizedMode,
        objectType: normalizedObjectType || null,
        stack: error.stack
      });
    }
  );

  if (cachedAi) {
    logger.info('AI cache hit', {
      auditId: context.auditId || null,
      mode: normalizedMode,
      objectType: normalizedObjectType || null,
      cache_key: cacheKey
    });

    return {
      ai: cachedAi,
      ai_prompt_mode: normalizedMode,
      cached: true,
      skipped: false,
      cache_key: cacheKey,
      metrics: {
        input_chars: 0,
        output_chars: 0,
        cache_hit: true,
        ai_cost: 0,
        total_cost: 0
      }
    };
  }

  if (context.deferAnalysis) {
    return {
      ai: null,
      ai_prompt_mode: normalizedMode,
      cached: false,
      skipped: false,
      needs_analysis: true,
      cache_key: cacheKey
    };
  }

  logger.info('AI cache miss', {
    auditId: context.auditId || null,
    mode: normalizedMode,
    objectType: normalizedObjectType || null,
    cache_key: cacheKey
  });

  const ai = await analyzeAudit(snapshot, safeIssues, {
    aiPromptMode: normalizedMode,
    aiFactsPayload: factsPayload,
    aiObjectType: normalizedObjectType,
    aiObjectLabel: context.aiObjectLabel || normalizedObjectType || null
  });

  const outputChars = JSON.stringify(ai).length;
  const costEstimate = calculateAiCostEstimate({
    inputChars,
    outputChars,
    cacheHit: false
  });

  await safeCall(
    () =>
      auditCacheService.saveCachedAiResult(cacheKey, ai, {
        ttlSeconds: env.aiCacheTtlSeconds,
        inputChars,
        outputChars,
        cacheMode: normalizedMode,
        estimatedCost: costEstimate.ai_cost
      }),
    null,
    (error) => {
      logger.warn('AI cache save failed', {
        auditId: context.auditId || null,
        mode: normalizedMode,
        objectType: normalizedObjectType || null,
        stack: error.stack
      });
    }
  );

  return {
    ai,
    ai_prompt_mode: normalizedMode,
    cached: false,
    skipped: false,
    cache_key: cacheKey,
    object_type: normalizedObjectType || null,
    metrics: {
      input_chars: inputChars,
      output_chars: outputChars,
      cache_hit: false,
      ai_cost: costEstimate.ai_cost,
      total_cost: costEstimate.total_cost
    }
  };
}

async function persistReportJson(auditId, reportJson) {
  await db.query(
    `
      UPDATE audit_results
      SET report_json = $2
      WHERE audit_id = $1
    `,
    [Number(auditId), reportJson]
  );
}

async function recordCostFromMetrics(auditId, metrics, promptMode) {
  if (!metrics) return;

  await safeCall(
    () =>
      recordAuditCost(auditId, {
        promptMode,
        model: env.openrouterModel || env.openaiModel || env.ollamaModel || null,
        cacheHit: Boolean(metrics.cache_hit),
        inputChars: metrics.input_chars || 0,
        outputChars: metrics.output_chars || 0,
        aiCost: metrics.ai_cost || 0,
        totalCost: metrics.total_cost || 0
      }),
    null,
    (error) => {
      logger.warn('Failed to record audit cost', {
        auditId,
        stack: error.stack
      });
    }
  );
}

function daysSince(dateValue) {
  if (!dateValue) return null;
  const value = new Date(dateValue).getTime();
  if (Number.isNaN(value)) return null;
  return Math.floor((Date.now() - value) / (24 * 60 * 60 * 1000));
}

function buildSummary(normalized) {
  return {
    contactCount: Array.isArray(normalized.contacts) ? normalized.contacts.length : 0,
    companyCount: Array.isArray(normalized.companies) ? normalized.companies.length : 0,
    emailCount: Array.isArray(normalized.emails) ? normalized.emails.length : 0,
    pipelineCount: normalized.pipelines.length,
    workflowCount: normalized.workflows.length,
    formCount: normalized.forms.length,
    contactPropertyCount: normalized.contactProperties.length,
    dealPropertyCount: normalized.dealProperties.length
  };
}

function auditPipelines(normalized, issues, recommendations) {
  if (normalized.pipelines.length > 5) {
    issues.push({
      severity: 'high',
      category: 'pipelines',
      title: 'Too many deal pipelines',
      detail: `${normalized.pipelines.length} deal pipelines exist. More than 5 can make forecasting and process governance difficult.`
    });
    recommendations.push({
      priority: 'high',
      title: 'Consolidate deal pipelines',
      detail: 'Review whether separate pipelines represent truly different sales processes, then merge overlapping ones.'
    });
  }
}

function auditWorkflows(normalized, issues, recommendations) {
  const inactive = normalized.workflows.filter(
    (workflow) => workflow.archived || !workflow.enabled
  );

  if (inactive.length > 0) {
    issues.push({
      severity: inactive.length >= 5 ? 'high' : 'medium',
      category: 'workflows',
      title: 'Workflows appear inactive or disabled',
      detail: `${inactive.length} workflows are disabled or archived.`
    });
    recommendations.push({
      priority: 'high',
      title: 'Review inactive workflows',
      detail: 'Disable, delete, or consolidate workflows with no recent activity or clear owner.'
    });
  }
}

function auditForms(normalized, issues, recommendations) {
  const staleForms = normalized.forms.filter((form) => {
    const age = daysSince(form.updatedAt || form.createdAt);
    return age !== null && age > STALE_FORM_DAYS;
  });

  if (staleForms.length > 0) {
    issues.push({
      severity: 'medium',
      category: 'forms',
      title: 'Forms may be stale',
      detail: `${staleForms.length} forms have not been updated in more than ${STALE_FORM_DAYS} days.`
    });
    recommendations.push({
      priority: 'medium',
      title: 'Review stale forms',
      detail: 'Confirm old forms are still embedded, compliant, and routing submissions correctly.'
    });
  }
}

function auditContacts(normalized, issues, recommendations) {
  const contacts = Array.isArray(normalized.contacts) ? normalized.contacts : [];
  if (contacts.length === 0) return;

  const missingEmail = contacts.filter((contact) => !String(contact.email || '').trim());
  if (missingEmail.length > 0) {
    issues.push({
      severity: missingEmail.length >= 100 ? 'high' : 'medium',
      category: 'contacts',
      title: 'Contacts missing email address',
      detail: `${missingEmail.length} contact${missingEmail.length === 1 ? '' : 's'} do not have an email address.`,
      affectedCount: missingEmail.length
    });
  }

  const missingLifecycle = contacts.filter((contact) => !String(contact.lifecycleStage || '').trim());
  if (missingLifecycle.length > 0) {
    issues.push({
      severity: missingLifecycle.length >= 150 ? 'high' : 'medium',
      category: 'contacts',
      title: 'Contacts missing lifecycle stage',
      detail: `${missingLifecycle.length} contact${missingLifecycle.length === 1 ? '' : 's'} do not have a lifecycle stage.`,
      affectedCount: missingLifecycle.length
    });
  }

  if (missingEmail.length > 0 || missingLifecycle.length > 0) {
    recommendations.push({
      priority: 'high',
      title: 'Backfill contact identity data',
      detail: 'Review contact records with missing email or lifecycle stage values so segmentation and automation stay reliable.'
    });
  }
}

function auditCompanies(normalized, issues, recommendations) {
  const companies = Array.isArray(normalized.companies) ? normalized.companies : [];
  if (companies.length === 0) return;

  const missingIdentity = companies.filter(
    (company) =>
      !String(company.name || '').trim() ||
      (!String(company.domain || '').trim() && !String(company.website || '').trim())
  );

  if (missingIdentity.length > 0) {
    issues.push({
      severity: missingIdentity.length >= 100 ? 'medium' : 'low',
      category: 'companies',
      title: 'Companies missing identity fields',
      detail: `${missingIdentity.length} company record${missingIdentity.length === 1 ? '' : 's'} are missing a company name, domain, or website.`,
      affectedCount: missingIdentity.length
    });
    recommendations.push({
      priority: 'medium',
      title: 'Review company records',
      detail: 'Backfill company names and domains where possible to improve account-level reporting.'
    });
  }
}

function auditEmails(normalized, issues, recommendations) {
  const emails = Array.isArray(normalized.emails) ? normalized.emails : [];
  if (emails.length === 0) return;

  const missingSubject = emails.filter((email) => !String(email.subject || '').trim());
  const missingTimestamp = emails.filter((email) => !String(email.timestamp || '').trim());

  if (missingSubject.length > 0) {
    issues.push({
      severity: missingSubject.length >= 100 ? 'medium' : 'low',
      category: 'emails',
      title: 'Emails missing subject lines',
      detail: `${missingSubject.length} email${missingSubject.length === 1 ? '' : 's'} do not have a subject line.`,
      affectedCount: missingSubject.length
    });
  }

  if (missingTimestamp.length > 0) {
    issues.push({
      severity: missingTimestamp.length >= 100 ? 'medium' : 'low',
      category: 'emails',
      title: 'Emails missing timestamps',
      detail: `${missingTimestamp.length} email${missingTimestamp.length === 1 ? '' : 's'} do not have a timestamp.`,
      affectedCount: missingTimestamp.length
    });
  }

  if (missingSubject.length > 0 || missingTimestamp.length > 0) {
    recommendations.push({
      priority: 'medium',
      title: 'Clean up email activity records',
      detail: 'Backfill subject lines and timestamps where possible so engagement reporting stays dependable.'
    });
  }
}

function auditProperties(normalized, issues, recommendations) {
  const customContactProperties = normalized.contactProperties.filter(
    (property) => !property.hubspotDefined
  );
  const customDealProperties = normalized.dealProperties.filter(
    (property) => !property.hubspotDefined
  );

  if (customContactProperties.length > CUSTOM_CONTACT_PROPERTY_THRESHOLD) {
    issues.push({
      severity: 'medium',
      category: 'properties',
      title: 'High contact property complexity',
      detail: `${customContactProperties.length} custom contact properties exist.`
    });
  }

  if (customDealProperties.length > CUSTOM_DEAL_PROPERTY_THRESHOLD) {
    issues.push({
      severity: 'medium',
      category: 'properties',
      title: 'High deal property complexity',
      detail: `${customDealProperties.length} custom deal properties exist.`
    });
  }

  if (
    customContactProperties.length > CUSTOM_CONTACT_PROPERTY_THRESHOLD ||
    customDealProperties.length > CUSTOM_DEAL_PROPERTY_THRESHOLD
  ) {
    recommendations.push({
      priority: 'medium',
      title: 'Rationalize CRM properties',
      detail: 'Identify duplicate, unused, or poorly named custom properties before adding more automation or reporting.'
    });
  }
}

function runRules(normalized) {
  const issues = [];
  const recommendations = [];

  auditContacts(normalized, issues, recommendations);
  auditCompanies(normalized, issues, recommendations);
  auditEmails(normalized, issues, recommendations);
  auditPipelines(normalized, issues, recommendations);
  auditWorkflows(normalized, issues, recommendations);
  auditForms(normalized, issues, recommendations);
  auditProperties(normalized, issues, recommendations);

  return {
    healthScore: calculateHealthScore(issues),
    summary: buildSummary(normalized),
    issues,
    recommendations
  };
}

async function fetchAuditData(accountKey, scope = null) {
  const selectedScope = normalizeAuditScope(scope);
  const scopeSet = new Set(selectedScope);
  let grantedScopes = new Set();

  try {
    const connection = await tokenService.getConnection(accountKey);
    grantedScopes = normalizeGrantedScopes(connection && connection.scopes);
  } catch {
    grantedScopes = new Set();
  }

  const capabilities = {
    contacts: 'available',
    companies: 'available',
    emails: 'available',
    deals: 'available',
    pipelines: 'available',
    workflows: 'available',
    forms: 'available',
    properties: 'available'
  };

  const contactsRequested = isScopeActive(scopeSet, 'contacts') && hasGrantedScopes(grantedScopes, 'crm.objects.contacts.read');
  const companiesRequested = isScopeActive(scopeSet, 'companies') && hasGrantedScopes(grantedScopes, 'crm.objects.companies.read');
  const emailsRequested = isScopeActive(scopeSet, 'emails') && hasGrantedScopes(grantedScopes, ['crm.objects.contacts.read', 'sales-email-read']);
  const dealsRequested = isScopeActive(scopeSet, 'deals') && hasGrantedScopes(grantedScopes, 'crm.objects.deals.read');
  const pipelinesRequested = isScopeActive(scopeSet, 'pipelines') && hasGrantedScopes(grantedScopes, 'crm.objects.deals.read');
  const workflowsRequested = isScopeActive(scopeSet, 'workflows') && hasGrantedScopes(grantedScopes, 'automation');
  const formsRequested = isScopeActive(scopeSet, 'forms') && hasGrantedScopes(grantedScopes, 'forms');
  const contactPropertiesRequested = isScopeActive(scopeSet, 'properties') && hasGrantedScopes(grantedScopes, 'crm.schemas.contacts.read');
  const dealPropertiesRequested = isScopeActive(scopeSet, 'properties') && hasGrantedScopes(grantedScopes, 'crm.schemas.deals.read');

  const settled = await Promise.allSettled([
    contactsRequested ? contactsService.fetchContacts(accountKey) : [],
    companiesRequested ? companiesService.fetchCompanies(accountKey) : [],
    emailsRequested ? emailsService.fetchEmails(accountKey) : [],
    dealsRequested ? dealsService.fetchDeals(accountKey) : [],
    pipelinesRequested ? pipelinesService.fetchDealPipelines(accountKey) : [],
    workflowsRequested ? workflowsService.fetchWorkflows(accountKey) : [],
    formsRequested ? formsService.fetchForms(accountKey) : [],
    contactPropertiesRequested ? propertiesService.fetchContactProperties(accountKey) : [],
    dealPropertiesRequested ? propertiesService.fetchDealProperties(accountKey) : []
  ]);

  const [
    contactsResult,
    companiesResult,
    emailsResult,
    dealsResult,
    pipelinesResult,
    workflowsResult,
    formsResult,
    contactPropertiesResult,
    dealPropertiesResult
  ] = settled;

  const contacts = contactsResult.status === 'fulfilled' ? contactsResult.value : [];
  if (!contactsRequested) capabilities.contacts = 'not_requested';
  else if (contactsResult.status === 'rejected') capabilities.contacts = 'unavailable';

  const companies = companiesResult.status === 'fulfilled' ? companiesResult.value : [];
  if (!companiesRequested) capabilities.companies = 'not_requested';
  else if (companiesResult.status === 'rejected') capabilities.companies = 'unavailable';

  const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];
  if (!emailsRequested) capabilities.emails = 'not_requested';
  else if (emailsResult.status === 'rejected') capabilities.emails = 'unavailable';

  const deals = dealsResult.status === 'fulfilled' ? dealsResult.value : [];
  if (!dealsRequested) capabilities.deals = 'not_requested';
  else if (dealsResult.status === 'rejected') capabilities.deals = 'unavailable';

  const pipelines = pipelinesResult.status === 'fulfilled' ? pipelinesResult.value : [];
  if (!pipelinesRequested) capabilities.pipelines = 'not_requested';
  else if (pipelinesResult.status === 'rejected') capabilities.pipelines = 'unavailable';

  const workflows = workflowsResult.status === 'fulfilled' ? workflowsResult.value : [];
  if (!workflowsRequested) capabilities.workflows = 'not_requested';
  else if (workflowsResult.status === 'rejected') capabilities.workflows = 'unavailable';

  const forms = formsResult.status === 'fulfilled' ? formsResult.value : [];
  if (!formsRequested) capabilities.forms = 'not_requested';
  else if (formsResult.status === 'rejected') capabilities.forms = 'unavailable';

  const contactProperties =
    contactPropertiesResult.status === 'fulfilled' ? contactPropertiesResult.value : [];
  const dealProperties =
    dealPropertiesResult.status === 'fulfilled' ? dealPropertiesResult.value : [];

  if (!isScopeActive(scopeSet, 'properties') || (!contactPropertiesRequested && !dealPropertiesRequested)) {
    capabilities.properties = 'not_requested';
  } else if (
    (contactPropertiesRequested && contactPropertiesResult.status === 'rejected') ||
    (dealPropertiesRequested && dealPropertiesResult.status === 'rejected')
  ) {
    capabilities.properties = 'unavailable';
  }

  return {
    contacts,
    companies,
    emails,
    deals,
    pipelines,
    workflows,
    forms,
    contactProperties,
    dealProperties,
    _capabilities: capabilities,
    _requestedScope: selectedScope
  };
}

async function persistAuditRun(accountKey, summary, auditResult) {
  await db.query(
    `
      INSERT INTO audit_runs (
        internal_account_key,
        raw_summary,
        audit_result
      )
      VALUES ($1, $2, $3)
    `,
    [accountKey, summary, auditResult]
  );
}

async function upsertPhase1Client(accountKey) {
  const connection = await tokenService.getConnection(accountKey);
  const tenantId = isUuid(accountKey) ? accountKey : null;

  if (!connection) {
    throw new AppError('HubSpot account is not connected', 404, 'hubspot_not_connected');
  }

  const result = await db.query(
    `
      INSERT INTO clients (
        internal_account_key,
        hubspot_account_id,
        access_token,
        refresh_token,
        tenant_id,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (internal_account_key)
      DO UPDATE SET
        hubspot_account_id = EXCLUDED.hubspot_account_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        tenant_id = COALESCE(EXCLUDED.tenant_id, clients.tenant_id),
        updated_at = NOW()
      RETURNING *
    `,
    [
      accountKey,
      connection.hubspot_portal_id ? String(connection.hubspot_portal_id) : null,
      connection.access_token,
      connection.refresh_token,
      tenantId
    ]
  );

  return result.rows[0];
}

async function persistPhase1Report(accountKey, snapshot, rules, report) {
  const client = await upsertPhase1Client(accountKey);
  let tenantId = client.tenant_id || null;
  let hubspotAccountUuid = null;
  let hubspotPortalId = client.hubspot_account_id ? String(client.hubspot_account_id) : null;

  if (isUuid(accountKey)) {
    tenantId = accountKey;
    const hubspotAccount = await hubspotAccountService.syncTenantHubSpotAccount(accountKey);
    hubspotAccountUuid = hubspotAccount.id;
    hubspotPortalId = hubspotAccount.hubspot_account_id
      ? String(hubspotAccount.hubspot_account_id)
      : hubspotPortalId;
  }

  const auditScope = buildAuditScope(client, tenantId);
  const auditNumber = await reserveAuditNumber(auditScope);

  const auditResult = await db.query(
    `
      INSERT INTO audits (
        client_id,
        audit_number,
        score,
        waste_estimate,
        tenant_id,
        hubspot_account_uuid,
        hubspot_portal_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      client.id,
      auditNumber,
      report.score,
      report.waste_estimate,
      tenantId,
      hubspotAccountUuid,
      hubspotPortalId
    ]
  );

  const audit = auditResult.rows[0];

  await db.query(
    `
      INSERT INTO audit_results (
        audit_id,
        snapshot_json,
        rules_json,
        report_json
      )
      VALUES ($1, $2, $3, $4)
    `,
    [audit.id, snapshot, rules, report]
  );

  if (report.ai_metrics) {
    await safeCall(
      () =>
        recordAuditCost(audit.id, {
          promptMode: report.ai_prompt_mode || null,
          model: env.openrouterModel || env.openaiModel || env.ollamaModel || null,
          cacheHit: Boolean(report.ai_metrics.cache_hit),
          inputChars: report.ai_metrics.input_chars || 0,
          outputChars: report.ai_metrics.output_chars || 0,
          aiCost: report.ai_metrics.ai_cost || 0,
          totalCost: report.ai_metrics.total_cost || 0
        }),
      null,
      (error) => {
        logger.warn('Failed to record audit cost', {
          auditId: audit.id,
          stack: error.stack
        });
      }
    );
  }

  return {
    ...report,
    id: audit.id,
    audit_number: audit.audit_number,
    client_id: client.id,
    tenant_id: tenantId,
    created_at: audit.created_at
  };
}

async function runHubSpotAudit(accountKey) {
  const raw = await fetchAuditData(accountKey);
  const normalized = normalizeAuditInput(raw);
  const result = runRules(normalized);

  await persistAuditRun(accountKey, result.summary, result);

  return result;
}

async function runPhase1Audit(accountKey, options = {}) {
  const scope = normalizeAuditScope(options.scope);
  const raw = await fetchAuditData(accountKey, scope);
  const snapshot = await buildAuditSnapshot(raw, accountKey, scope);
  const rules = runAuditRules(snapshot);
  const score = calculateScore(snapshot, rules);
  const wasteEstimate = estimateWaste(snapshot);
  const aiPromptMode = normalizePromptMode(options.aiPromptMode);
  let aiOutcome = null;
  let aiError = null;

  if (options.includeAi && (isAiEnabled() || isOllamaEnabled() || isOpenRouterEnabled())) {
    const aiIssues = normalizeIssuesForAi(rules.issues).slice(0, 40);
    aiOutcome = await safeCall(
      () => resolveOptimizedAiAnalysis(snapshot, aiIssues, aiPromptMode, {
        auditId: accountKey
      }),
      null,
      (error) => {
        aiError = {
          code: error.code || 'openai_failed',
          message: error.message || 'AI analysis failed',
          details: error.details || null
        };
        logger.error('AI analysis failed during audit generation', {
          auditMode: aiPromptMode,
          stack: error.stack
        });
      }
    );
  }

  const report = generateAuditReport(
    snapshot,
    rules,
    score,
    wasteEstimate,
    aiOutcome && aiOutcome.ai ? aiOutcome.ai : null
  );

  if (aiOutcome && aiOutcome.ai) {
    report.ai = aiOutcome.ai;
    report.ai_score = calculateAiScore(report.score, aiOutcome.ai);
    report.ai_prompt_mode = aiOutcome.ai_prompt_mode;
    report.ai_metrics = aiOutcome.metrics || null;
    report.ai_variants = {
      ...(report.ai_variants || {}),
      [aiOutcome.ai_prompt_mode]: aiOutcome.ai
    };
    report.ai_jobs = {
      ...(report.ai_jobs || {}),
      [aiOutcome.ai_prompt_mode]: {
        status: aiOutcome.skipped ? 'skipped' : 'complete',
        started_at: nowIso(),
        completed_at: nowIso(),
        cached: Boolean(aiOutcome.cached),
        skipped: Boolean(aiOutcome.skipped)
      }
    };
  } else if (options.includeAi && (isAiEnabled() || isOllamaEnabled() || isOpenRouterEnabled())) {
    // Do not fail the audit if AI fails; return a diagnostic field instead.
    report.ai_error = aiError || {
      code: 'openai_failed',
      message: 'AI analysis failed',
      details: null
    };
  }

  report.scope = scope;
  report.scope_label = scope.length === 1 && scope[0] === 'full'
    ? 'Full Audit'
    : `Custom audit: ${scope.join(', ')}`;

  const savedReport = await persistPhase1Report(accountKey, snapshot, rules, report);

  return savedReport;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function normalizeCompactIssue(issue) {
  if (!issue || typeof issue !== 'object') return null;

  return {
    id: issue.id || null,
    title: issue.title || null,
    message: issue.message || issue.title || 'Issue',
    category: issue.category || null,
    severity: issue.severity || null,
    riskLevel: issue.riskLevel || null,
    objectType: issue.objectType || issue.object_type || null,
    objectGroup: issue.objectGroup || issue.object_group || null,
    affectedCount: issue.affectedCount || issue.affected_count || 0,
    impact: issue.impact || null,
    recommendation: issue.recommendation || null
  };
}

function normalizeReportObjectType(value) {
  const type = String(value || '').toLowerCase();
  if (
    type === 'contacts' ||
    type === 'companies' ||
    type === 'deals' ||
    type === 'workflows' ||
    type === 'forms' ||
    type === 'emails' ||
    type === 'properties' ||
    type === 'pipelines' ||
    type === 'owners' ||
    type === 'lists' ||
    type === 'associations'
  ) {
    return type;
  }
  return null;
}

function formatCompactCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? new Intl.NumberFormat('en-US').format(count) : '0';
}

function safeListCount(list, predicate) {
  return (Array.isArray(list) ? list : []).reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function normalizeObjectText(value) {
  return String(value || '').trim().toLowerCase();
}

function objectCompanyTokens(company) {
  const tokens = [
    company && company.name,
    company && company.domain,
    company && company.website
  ]
    .map((value) => normalizeObjectText(value))
    .filter(Boolean);

  return Array.from(new Set(tokens));
}

function objectContactCompanyMatches(company, contact) {
  const contactCompany = normalizeObjectText(contact && contact.company);
  if (!contactCompany) return false;
  return objectCompanyTokens(company).some((token) => token && contactCompany.includes(token));
}

function objectDealCompanyMatches(company, deal) {
  const companyId = String(company && company.id ? company.id : '').trim();
  const dealCompanyId = String((deal && deal.associatedCompanyId) || '').trim();
  if (companyId && dealCompanyId && companyId === dealCompanyId) return true;
  const dealCompanyIds = Array.isArray(deal && deal.associatedCompanyIds)
    ? deal.associatedCompanyIds.map((value) => String(value).trim())
    : [];
  if (companyId && dealCompanyIds.includes(companyId)) return true;
  return false;
}

function summarizeObjectIssues(issues) {
  return (Array.isArray(issues) ? issues : []).reduce(
    (acc, issue) => {
      const risk = String(issue.riskLevel || issue.severity || 'low').toLowerCase();
      if (acc[risk] !== undefined) {
        acc[risk] += 1;
      }
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  );
}

function scoreObjectIssues(issues) {
  const counts = (Array.isArray(issues) ? issues : []).reduce(
    (acc, issue) => {
      const sev = String(issue.riskLevel || issue.severity || 'low').toLowerCase();
      acc.total += 1;
      if (acc[`${sev}Issues`] !== undefined) {
        acc[`${sev}Issues`] += 1;
      }
      return acc;
    },
    { total: 0, criticalIssues: 0, highIssues: 0, mediumIssues: 0, lowIssues: 0, infoIssues: 0 }
  );

  const penalty =
    Math.min((counts.criticalIssues || 0) * 15, 45) +
    Math.min((counts.highIssues || 0) * 8, 35) +
    Math.min((counts.mediumIssues || 0) * 4, 20) +
    Math.min((counts.lowIssues || 0) * 1, 10);

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const label = score >= 90 ? 'Excellent' : score >= 75 ? 'Healthy' : score >= 60 ? 'Needs Attention' : score >= 40 ? 'At Risk' : 'Critical';
  const riskLevel = score >= 75 ? 'low' : score >= 60 ? 'medium' : score >= 40 ? 'high' : 'critical';
  const text = score >= 90
    ? 'This HubSpot portal looks excellent with only a few low-risk findings.'
    : score >= 75
      ? 'This HubSpot portal looks healthy with mostly low-risk findings.'
      : score >= 60
        ? (counts.highIssues > 0
            ? 'This HubSpot portal needs attention due to several high-risk issues.'
            : 'This HubSpot portal needs attention due to several medium-risk issues.')
        : score >= 40
          ? (counts.criticalIssues > 0
              ? 'This HubSpot portal is at risk because critical issues need immediate review.'
              : 'This HubSpot portal is at risk because several high-risk issues need review.')
          : (counts.criticalIssues > 0
              ? 'This HubSpot portal needs urgent attention because critical issues were found.'
              : 'This HubSpot portal needs urgent attention because multiple high-risk issues were found.');

  return {
    score,
    label,
    text,
    riskLevel,
    summary: counts,
    penalty
  };
}

function buildObjectBreakdownItem(objectType, issues, totalRecords) {
  const scoreInfo = scoreObjectIssues(issues);
  const highestRiskLevel = scoreInfo.summary.criticalIssues > 0
    ? 'critical'
    : scoreInfo.summary.highIssues > 0
      ? 'high'
      : scoreInfo.summary.mediumIssues > 0
        ? 'medium'
        : scoreInfo.summary.lowIssues > 0
          ? 'low'
          : 'info';
  const topIssue = [...(Array.isArray(issues) ? issues : [])]
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const aRisk = String(a.riskLevel || a.severity || 'low').toLowerCase();
      const bRisk = String(b.riskLevel || b.severity || 'low').toLowerCase();
      const diff = (rank[aRisk] ?? 4) - (rank[bRisk] ?? 4);
      if (diff !== 0) return diff;
      return String(a.title || a.message || '').localeCompare(String(b.title || b.message || ''));
    })[0] || null;
  const label = objectType ? `${objectType.charAt(0).toUpperCase()}${objectType.slice(1)}` : 'Object';

  return {
    objectType,
    label,
    score: scoreInfo.score,
    scoreLabel: scoreInfo.label,
    score_label: scoreInfo.label,
    score_summary: {
      text: scoreInfo.text,
      label: scoreInfo.label,
      riskLevel: scoreInfo.riskLevel
    },
    summary: scoreInfo.text,
    totalIssues: scoreInfo.summary.total,
    criticalIssues: scoreInfo.summary.criticalIssues,
    highIssues: scoreInfo.summary.highIssues,
    mediumIssues: scoreInfo.summary.mediumIssues,
    lowIssues: scoreInfo.summary.lowIssues,
    infoIssues: scoreInfo.summary.infoIssues,
    highestRiskLevel,
    highestRisk: highestRiskLevel,
    quickSummary: scoreInfo.summary.total
      ? `${formatCompactCount(scoreInfo.summary.total)} issue${scoreInfo.summary.total === 1 ? '' : 's'} across ${label.toLowerCase()}`
      : `No active issues found for ${label.toLowerCase()}`,
    totalRecords: Number(totalRecords || 0),
    topFinding: topIssue ? (topIssue.title || topIssue.message || 'Issue') : 'No issues'
  };
}

function buildObjectParameterRows(snapshotJson, objectType) {
  const snapshot = snapshotJson && typeof snapshotJson === 'object' ? snapshotJson : {};
  const normalized = normalizeReportObjectType(objectType);
  const rows = [];

  const pushRow = (label, count, total, riskLevel = '-') => {
    const totalCount = Number(total || 0);
    const valueCount = Number(count || 0);
    const percentage = totalCount > 0 ? `${Math.round((valueCount / totalCount) * 100)}%` : '--';
    rows.push({
      label,
      count: formatCompactCount(valueCount),
      percentage,
      change: '-',
      riskLevel
    });
  };

  if (normalized === 'companies') {
    const companies = Array.isArray(snapshot.companies) ? snapshot.companies : [];
    const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
    const deals = Array.isArray(snapshot.deals) ? snapshot.deals : [];
    const total = companies.length;
    const withName = safeListCount(companies, (company) => String(company.name || '').trim().length > 0);
    const withWebsite = safeListCount(companies, (company) => String(company.website || company.domain || '').trim().length > 0);
    const withPhone = safeListCount(companies, (company) => String(company.phone || '').trim().length > 0);
    const withOwner = safeListCount(companies, (company) => String(company.ownerId || '').trim().length > 0);
    const withIndustry = safeListCount(companies, (company) => String(company.industry || '').trim().length > 0);
    const withEmployees = safeListCount(companies, (company) => String(company.employees || '').trim().length > 0);
    const withCountry = safeListCount(companies, (company) => String(company.country || '').trim().length > 0);
    const withRevenue = safeListCount(companies, (company) => String(company.annualRevenue || '').trim().length > 0);
    const withAssociatedContacts = safeListCount(companies, (company) => contacts.some((contact) => objectContactCompanyMatches(company, contact)));
    const withDealsAssociated = safeListCount(companies, (company) => deals.some((deal) => objectDealCompanyMatches(company, deal)));

    pushRow('Total Companies', total, total, '-');
    pushRow('Companies with company name', withName, total, '-');
    pushRow('Companies without company name', total - withName, total, total - withName > 0 ? 'Critical Risk' : '-');
    pushRow('Companies with website', withWebsite, total, '-');
    pushRow('Companies without website', total - withWebsite, total, total - withWebsite > 0 ? 'Critical Risk' : '-');
    pushRow('Companies with phone', withPhone, total, '-');
    pushRow('Companies without phone', total - withPhone, total, total - withPhone > 0 ? 'High Risk' : '-');
    pushRow('Companies with Owners', withOwner, total, '-');
    pushRow('Companies without Owners', total - withOwner, total, total - withOwner > 0 ? 'Critical Risk' : '-');
    pushRow('Companies with industry', withIndustry, total, '-');
    pushRow('Companies without industry', total - withIndustry, total, total - withIndustry > 0 ? 'High Risk' : '-');
    pushRow('Companies with Associated Contacts', withAssociatedContacts, total, '-');
    pushRow('Companies without Associated Contacts', total - withAssociatedContacts, total, total - withAssociatedContacts > 0 ? 'Critical Risk' : '-');
    pushRow('Companies with Deals Associated', withDealsAssociated, total, '-');
    pushRow('Companies without Deals Associated', total - withDealsAssociated, total, total - withDealsAssociated > 0 ? 'Critical Risk' : '-');
    pushRow('Companies with employee count', withEmployees, total, '-');
    pushRow('Companies without employee count', total - withEmployees, total, total - withEmployees > 0 ? 'High Risk' : '-');
    pushRow('Companies with country', withCountry, total, '-');
    pushRow('Companies without country', total - withCountry, total, total - withCountry > 0 ? 'High Risk' : '-');
    pushRow('Companies with annual revenue', withRevenue, total, '-');
    pushRow('Companies without annual revenue', total - withRevenue, total, total - withRevenue > 0 ? 'High Risk' : '-');
    return rows;
  }

  if (normalized === 'contacts') {
    const contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
    const total = contacts.length;
    const withEmail = safeListCount(contacts, (contact) => String(contact.email || '').trim().length > 0);
    const withName = safeListCount(contacts, (contact) => String(contact.firstname || '').trim().length > 0 || String(contact.lastname || '').trim().length > 0);
    const withLifecycle = safeListCount(contacts, (contact) => String(contact.lifecycleStage || '').trim().length > 0);
    const withPhone = safeListCount(contacts, (contact) => String(contact.phone || '').trim().length > 0);
    const withCompany = safeListCount(contacts, (contact) => String(contact.company || '').trim().length > 0);
    const withOwner = safeListCount(contacts, (contact) => String(contact.ownerId || '').trim().length > 0);
    const withJobTitle = safeListCount(contacts, (contact) => String(contact.jobTitle || '').trim().length > 0);

    pushRow('Total Contacts', total, total, '-');
    pushRow('Contacts with email', withEmail, total, '-');
    pushRow('Contacts without email', total - withEmail, total, total - withEmail > 0 ? 'Critical Risk' : '-');
    pushRow('Contacts with name', withName, total, '-');
    pushRow('Contacts without name', total - withName, total, total - withName > 0 ? 'Medium Risk' : '-');
    pushRow('Contacts with lifecycle stage', withLifecycle, total, '-');
    pushRow('Contacts without lifecycle stage', total - withLifecycle, total, total - withLifecycle > 0 ? 'High Risk' : '-');
    pushRow('Contacts with phone', withPhone, total, '-');
    pushRow('Contacts without phone', total - withPhone, total, total - withPhone > 0 ? 'Low Risk' : '-');
    pushRow('Contacts with company', withCompany, total, '-');
    pushRow('Contacts without company', total - withCompany, total, total - withCompany > 0 ? 'Medium Risk' : '-');
    pushRow('Contacts with owner', withOwner, total, '-');
    pushRow('Contacts without owner', total - withOwner, total, total - withOwner > 0 ? 'High Risk' : '-');
    pushRow('Contacts with job title', withJobTitle, total, '-');
    pushRow('Contacts without job title', total - withJobTitle, total, total - withJobTitle > 0 ? 'Low Risk' : '-');
    return rows;
  }

  if (normalized === 'emails') {
    const emails = Array.isArray(snapshot.emails) ? snapshot.emails : [];
    const total = emails.length;
    const withSubject = safeListCount(emails, (email) => String(email.subject || '').trim().length > 0);
    const withTimestamp = safeListCount(emails, (email) => String(email.timestamp || '').trim().length > 0);
    const withOwner = safeListCount(emails, (email) => String(email.ownerId || '').trim().length > 0);
    const withDirection = safeListCount(emails, (email) => String(email.direction || '').trim().length > 0);

    pushRow('Total Emails', total, total, '-');
    pushRow('Emails with subject', withSubject, total, '-');
    pushRow('Emails without subject', total - withSubject, total, total - withSubject > 0 ? 'Critical Risk' : '-');
    pushRow('Emails with timestamp', withTimestamp, total, '-');
    pushRow('Emails without timestamp', total - withTimestamp, total, total - withTimestamp > 0 ? 'High Risk' : '-');
    pushRow('Emails with owner', withOwner, total, '-');
    pushRow('Emails without owner', total - withOwner, total, total - withOwner > 0 ? 'High Risk' : '-');
    pushRow('Emails with direction', withDirection, total, '-');
    pushRow('Emails without direction', total - withDirection, total, total - withDirection > 0 ? 'Low Risk' : '-');
    return rows;
  }

  if (normalized === 'workflows') {
    const workflows = Array.isArray(snapshot.workflows) ? snapshot.workflows : [];
    const total = workflows.length;
    const active = safeListCount(workflows, (workflow) => workflow.status === 'active');
    const stale = safeListCount(workflows, (workflow) => Number(workflow.last_triggered_days_ago || 0) > 30);

    pushRow('Total Workflows', total, total, '-');
    pushRow('Active workflows', active, total, '-');
    pushRow('Inactive workflows', total - active, total, total - active > 0 ? 'High Risk' : '-');
    pushRow('Workflows stale > 30 days', stale, total, stale > 0 ? 'Medium Risk' : '-');
    return rows;
  }

  if (normalized === 'forms') {
    const forms = Array.isArray(snapshot.forms) ? snapshot.forms : [];
    const total = forms.length;
    const withSubmissions = safeListCount(forms, (form) => Number(form.submissions_last_30_days || 0) > 0);

    pushRow('Total Forms', total, total, '-');
    pushRow('Forms with submissions', withSubmissions, total, '-');
    pushRow('Forms without submissions', total - withSubmissions, total, total - withSubmissions > 0 ? 'Medium Risk' : '-');
    return rows;
  }

  if (normalized === 'deals') {
    const deals = Array.isArray(snapshot.deals) ? snapshot.deals : [];
    const total = deals.length;
    const withName = safeListCount(deals, (deal) => String(deal.name || '').trim().length > 0);
    const withPipeline = safeListCount(deals, (deal) => String(deal.pipeline || '').trim().length > 0);
    const withStage = safeListCount(deals, (deal) => String(deal.stage || '').trim().length > 0);
    const withOwner = safeListCount(deals, (deal) => String(deal.ownerId || '').trim().length > 0);
    const withCompany = safeListCount(deals, (deal) => String(deal.associatedCompanyId || '').trim().length > 0 || (Array.isArray(deal.associatedCompanyIds) && deal.associatedCompanyIds.length > 0));
    const withCloseDate = safeListCount(deals, (deal) => String(deal.closeDate || '').trim().length > 0);
    const withAmount = safeListCount(deals, (deal) => String(deal.amount || '').trim().length > 0);
    const staleDeals = safeListCount(deals, (deal) => {
      const timestamp = Date.parse(deal.updatedAt || '');
      return Number.isFinite(timestamp) && timestamp < Date.now() - 30 * 24 * 60 * 60 * 1000;
    });

    pushRow('Total Deals', total, total, '-');
    pushRow('Deals with deal name', withName, total, '-');
    pushRow('Deals without deal name', total - withName, total, total - withName > 0 ? 'Critical Risk' : '-');
    pushRow('Deals with pipeline', withPipeline, total, '-');
    pushRow('Deals without pipeline', total - withPipeline, total, total - withPipeline > 0 ? 'High Risk' : '-');
    pushRow('Deals with stage', withStage, total, '-');
    pushRow('Deals without stage', total - withStage, total, total - withStage > 0 ? 'High Risk' : '-');
    pushRow('Deals with owner', withOwner, total, '-');
    pushRow('Deals without owner', total - withOwner, total, total - withOwner > 0 ? 'High Risk' : '-');
    pushRow('Deals with associated company', withCompany, total, '-');
    pushRow('Deals without associated company', total - withCompany, total, total - withCompany > 0 ? 'Medium Risk' : '-');
    pushRow('Deals with close date', withCloseDate, total, '-');
    pushRow('Deals with amount', withAmount, total, '-');
    pushRow('Stale deals > 30 days', staleDeals, total || staleDeals || 1, staleDeals > 0 ? 'Medium Risk' : '-');
    return rows;
  }

  if (normalized === 'pipelines') {
    const pipelines = Array.isArray(snapshot.pipelines) ? snapshot.pipelines : [];
    const total = pipelines.length;
    const staleDeals = pipelines.reduce((sum, pipeline) => sum + Number(pipeline.stale_deals || 0), 0);
    const totalDeals = pipelines.reduce((sum, pipeline) => sum + Number(pipeline.deals_count || 0), 0);
    const withStageCount = safeListCount(pipelines, (pipeline) => Number(pipeline.stages || 0) > 0);

    pushRow('Total Pipelines', total, total, '-');
    pushRow('Pipelines with stages', withStageCount, total, '-');
    pushRow('Total deals', totalDeals, totalDeals || 1, '-');
    pushRow('Stale deals', staleDeals, totalDeals || staleDeals || 1, staleDeals > 0 ? 'High Risk' : '-');
    return rows;
  }

  if (normalized === 'owners' || normalized === 'lists' || normalized === 'associations' || normalized === 'properties') {
    const items = Array.isArray(snapshot[normalized]) ? snapshot[normalized] : [];
    const total = items.length;
    pushRow(`Total ${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`, total, total, '-');
    return rows;
  }

  pushRow('No scoped parameters available', 0, 0, 'INFO');
  return rows;
}

function buildCompactRules(rulesJson, issueLimit = 40, issueCount = null) {
  const rules = rulesJson && typeof rulesJson === 'object' ? rulesJson : {};
  const issues = Array.isArray(rules.issues) ? rules.issues : [];

  return {
    ...rules,
    issue_count: issueCount ?? rules.issue_count ?? issues.length,
    issues: issues.slice(0, issueLimit).map(normalizeCompactIssue).filter(Boolean)
  };
}

function buildCompactReportJson(reportJson) {
  const report = reportJson && typeof reportJson === 'object' ? reportJson : {};
  const allowedKeys = [
    'score',
    'health_score',
    'score_label',
    'score_summary',
    'total_issues',
    'critical_issues',
    'high_issues',
    'medium_issues',
    'low_issues',
    'info_issues',
    'waste_estimate',
    'summary',
    'risk_summary',
    'executive_summary',
    'object_breakdown',
    'ai',
    'ai_error',
    'ai_metrics',
    'ai_prompt_mode',
    'ai_score',
    'ai_status',
    'ai_variants',
    'ai_jobs',
    'ai_object_variants',
    'ai_object_jobs',
    'ai_object_errors',
    'scope',
    'scope_label'
  ];

  return allowedKeys.reduce((compact, key) => {
    if (report[key] !== undefined) {
      compact[key] = report[key];
    }
    return compact;
  }, {});
}

function getCapabilitySubset(capabilities, keys) {
  if (!capabilities || typeof capabilities !== 'object') return null;

  return keys.reduce((subset, key) => {
    if (capabilities[key] !== undefined) {
      subset[key] = capabilities[key];
    }
    return subset;
  }, {});
}

function buildSectionSnapshot(snapshotJson, sectionKey) {
  const snapshot = snapshotJson && typeof snapshotJson === 'object' ? snapshotJson : {};
  const capabilities = snapshot.capabilities && typeof snapshot.capabilities === 'object' ? snapshot.capabilities : null;

  if (sectionKey === 'pipeline') {
    return {
      pipelines: Array.isArray(snapshot.pipelines) ? snapshot.pipelines : [],
      capabilities: getCapabilitySubset(capabilities, ['pipelines', 'deals']),
      scope: Array.isArray(snapshot.scope) ? snapshot.scope : null
    };
  }

  if (sectionKey === 'automation') {
    return {
      workflows: Array.isArray(snapshot.workflows) ? snapshot.workflows : [],
      capabilities: getCapabilitySubset(capabilities, ['workflows']),
      scope: Array.isArray(snapshot.scope) ? snapshot.scope : null
    };
  }

  return {
    forms: Array.isArray(snapshot.forms) ? snapshot.forms : [],
    usage: snapshot.usage && typeof snapshot.usage === 'object' ? snapshot.usage : null,
    data_cleanliness:
      snapshot.data_cleanliness && typeof snapshot.data_cleanliness === 'object'
        ? snapshot.data_cleanliness
        : null,
    capabilities: getCapabilitySubset(capabilities, ['forms', 'properties']),
    scope: Array.isArray(snapshot.scope) ? snapshot.scope : null
  };
}

function issueMatchesDetailSection(issue, sectionKey) {
  const category = String(issue && issue.category || '').toLowerCase();
  const objectType = String(issue && (issue.objectType || issue.object_type || '')).toLowerCase();
  const objectGroup = String(issue && (issue.objectGroup || issue.object_group || '')).toLowerCase();

  if (sectionKey === 'pipeline') {
    return category === 'pipelines' || objectType === 'pipelines';
  }

  if (sectionKey === 'automation') {
    return category === 'workflows' || objectType === 'workflows' || objectGroup === 'workflows';
  }

  return (
    category === 'forms' ||
    category === 'usage' ||
    category === 'data_cleanliness' ||
    category === 'properties' ||
    objectType === 'forms' ||
    objectType === 'owners' ||
    objectType === 'properties'
  );
}

function buildSectionRules(rulesJson, sectionKey) {
  const rules = rulesJson && typeof rulesJson === 'object' ? rulesJson : {};
  const issues = Array.isArray(rules.issues) ? rules.issues.filter((issue) => issueMatchesDetailSection(issue, sectionKey)) : [];

  return {
    ...rules,
    section_key: sectionKey,
    section_issue_count: issues.length,
    issues
  };
}

function buildSummaryBlock(reportJson, row) {
  const summary = reportJson && typeof reportJson === 'object' && reportJson.summary && typeof reportJson.summary === 'object'
    ? reportJson.summary
    : {};
  const summaryIssueCount =
    summary.issue_count !== undefined && summary.issue_count !== null
      ? summary.issue_count
      : row && row.rules_json && row.rules_json.issue_count !== undefined
        ? row.rules_json.issue_count
        : 0;

  return {
    pipeline_count: Number(summary.pipeline_count ?? 0),
    workflow_count: Number(summary.workflow_count ?? 0),
    form_count: Number(summary.form_count ?? 0),
    active_users: Number(summary.active_users ?? 0),
    total_users: Number(summary.total_users ?? 0),
    usage_status: summary.usage_status || 'unknown',
    issue_count: Number(summaryIssueCount || 0),
    health_score: summary.health_score ?? reportJson.health_score ?? row.score,
    score_label: summary.score_label ?? reportJson.score_label ?? null,
    score_summary: summary.score_summary ?? reportJson.score_summary ?? null
  };
}

function buildPhase1ReportResponse(row, { includeSnapshot = true, issueLimit = 40 } = {}) {
  const reportJson = row.report_json || {};
  const rulesJson = row.rules_json || {};
  const storedReport = includeSnapshot ? reportJson : buildCompactReportJson(reportJson);
  const computedReport = includeSnapshot
    ? generateAuditReport(
        row.snapshot_json,
        rulesJson,
        row.score,
        row.waste_estimate,
        getStoredFullAi(reportJson)
      )
    : null;
  const nextReport = includeSnapshot
    ? {
        ...storedReport,
        ...computedReport
      }
    : {
        ...storedReport
      };
  const summary = buildSummaryBlock(nextReport, row);
  const rules = includeSnapshot
    ? {
        ...rulesJson,
        issue_count: rulesJson.issue_count ?? summary.issue_count
      }
    : buildCompactRules(rulesJson, issueLimit, summary.issue_count);

  const response = {
    ...nextReport,
    id: row.id,
    audit_number: row.audit_number,
    client_id: row.client_id,
    score: nextReport.score ?? row.score,
    health_score: nextReport.health_score ?? row.score,
    waste_estimate: nextReport.waste_estimate ?? row.waste_estimate,
    created_at: row.created_at,
    hubspot_portal_id: row.hubspot_portal_id,
    hubspot_account_uuid: row.hubspot_account_uuid,
    summary,
    rules,
    scope: nextReport && Array.isArray(nextReport.scope) ? nextReport.scope : null,
    scope_label: nextReport && nextReport.scope_label ? nextReport.scope_label : null,
    _summary_only: !includeSnapshot
  };

  if (includeSnapshot) {
    response.snapshot = row.snapshot_json;
  } else {
    delete response.issue_details;
    delete response.issues;
    delete response.risk_sections;
  }

  return response;
}

function buildObjectReportResponse(row, objectType) {
  const normalizedObjectType = normalizeReportObjectType(objectType);
  const reportJson = buildCompactReportJson(row.report_json || {});
  const snapshotJson = row.snapshot_json && typeof row.snapshot_json === 'object' ? row.snapshot_json : {};
  const rulesJson = row.rules_json && typeof row.rules_json === 'object' ? row.rules_json : {};
  const filteredIssues = Array.isArray(rulesJson.issues)
    ? rulesJson.issues.filter((issue) => issueMatchesObjectType(issue, normalizedObjectType)).map(normalizeCompactIssue).filter(Boolean)
    : [];
  const objectBreakdownItem = buildObjectBreakdownItem(
    normalizedObjectType,
    filteredIssues,
    Array.isArray(snapshotJson[normalizedObjectType]) ? snapshotJson[normalizedObjectType].length : 0
  );
  const objectParameters = buildObjectParameterRows(snapshotJson, normalizedObjectType);
  const objectRules = buildCompactRules(
    {
      ...rulesJson,
      issues: filteredIssues
    },
    filteredIssues.length,
    filteredIssues.length
  );
  const objectRiskSummary = summarizeObjectIssues(filteredIssues);

  const response = {
    ...reportJson,
    id: row.id,
    audit_number: row.audit_number,
    client_id: row.client_id,
    score: objectBreakdownItem.score ?? reportJson.score ?? row.score,
    health_score: objectBreakdownItem.score ?? reportJson.health_score ?? row.score,
    score_label: objectBreakdownItem.scoreLabel ?? reportJson.score_label ?? null,
    score_summary: objectBreakdownItem.score_summary || reportJson.score_summary || null,
    waste_estimate: reportJson.waste_estimate ?? row.waste_estimate,
    created_at: row.created_at,
    hubspot_portal_id: row.hubspot_portal_id,
    hubspot_account_uuid: row.hubspot_account_uuid,
    summary: reportJson.summary || null,
    rules: objectRules,
    issueDetails: filteredIssues,
    issue_details: filteredIssues,
    objectBreakdown: [objectBreakdownItem],
    object_breakdown: [objectBreakdownItem],
    objectParameters,
    object_parameters: objectParameters,
    objectRecordTotal: objectBreakdownItem.totalRecords,
    object_record_total: objectBreakdownItem.totalRecords,
    objectRiskSummary,
    object_risk_summary: objectRiskSummary,
    scope: Array.isArray(reportJson.scope) ? reportJson.scope : null,
    scope_label: reportJson.scope_label || null,
    snapshot: {
      scope: Array.isArray(snapshotJson.scope) ? snapshotJson.scope : null,
      [normalizedObjectType]: Array.isArray(snapshotJson[normalizedObjectType]) ? snapshotJson[normalizedObjectType] : []
    },
    objectSnapshot: {
      [normalizedObjectType]: Array.isArray(snapshotJson[normalizedObjectType]) ? snapshotJson[normalizedObjectType] : []
    },
    _object_type: normalizedObjectType
  };

  // Intentionally keep the object view compact and object-specific.
  delete response.risk_summary;
  delete response.executive_summary;
  delete response.risk_sections;

  return response;
}

async function getPhase1Report(auditId, tenantId = null) {
  const tenantClause = tenantId ? 'AND audits.tenant_id = $2' : '';
  const params = tenantId ? [auditId, tenantId] : [auditId];
  const result = await db.query(
    `
      SELECT
        audits.id,
        audits.audit_number,
        audits.client_id,
        audits.score,
        audits.waste_estimate,
        audits.created_at,
        audits.hubspot_portal_id,
        audits.hubspot_account_uuid,
        audit_results.snapshot_json,
        audit_results.rules_json,
        audit_results.report_json
      FROM audits
      JOIN audit_results ON audit_results.audit_id = audits.id
      WHERE audits.id = $1
      ${tenantClause}
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found', 404, 'audit_report_not_found');
  }

  return buildPhase1ReportResponse(result.rows[0], { includeSnapshot: true });
}

async function getPhase1ReportObject(auditId, objectType, tenantId = null) {
  const normalizedObjectType = normalizeReportObjectType(objectType);
  if (!normalizedObjectType) {
    throw new AppError('Audit object report not found', 404, 'audit_object_report_not_found');
  }

  const tenantClause = tenantId ? 'AND audits.tenant_id = $2' : '';
  const params = tenantId ? [auditId, tenantId] : [auditId];
  const result = await db.query(
    `
      SELECT
        audits.id,
        audits.audit_number,
        audits.client_id,
        audits.score,
        audits.waste_estimate,
        audits.created_at,
        audits.hubspot_portal_id,
        audits.hubspot_account_uuid,
        audit_results.snapshot_json,
        audit_results.rules_json,
        audit_results.report_json
      FROM audits
      JOIN audit_results ON audit_results.audit_id = audits.id
      WHERE audits.id = $1
      ${tenantClause}
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found', 404, 'audit_report_not_found');
  }

  return buildObjectReportResponse(result.rows[0], normalizedObjectType);
}

async function getPhase1ReportSummary(auditId, tenantId = null) {
  const tenantClause = tenantId ? 'AND audits.tenant_id = $2' : '';
  const params = tenantId ? [auditId, tenantId] : [auditId];
  const result = await db.query(
    `
      SELECT
        audits.id,
        audits.audit_number,
        audits.client_id,
        audits.score,
        audits.waste_estimate,
        audits.created_at,
        audits.hubspot_portal_id,
        audits.hubspot_account_uuid,
        audit_results.rules_json,
        audit_results.report_json
      FROM audits
      JOIN audit_results ON audit_results.audit_id = audits.id
      WHERE audits.id = $1
      ${tenantClause}
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found', 404, 'audit_report_not_found');
  }

  return buildPhase1ReportResponse(result.rows[0], {
    includeSnapshot: false,
    issueLimit: 40
  });
}

async function getPhase1ReportDetailSection(auditId, section, tenantId = null) {
  const sectionKey = normalizeDetailSection(section);
  if (!sectionKey || !DETAIL_SECTION_KEYS.has(sectionKey)) {
    throw new AppError('Audit detail section not found', 404, 'audit_detail_section_not_found');
  }

  const tenantClause = tenantId ? 'AND audits.tenant_id = $2' : '';
  const params = tenantId ? [auditId, tenantId] : [auditId];
  const result = await db.query(
    `
      SELECT
        audits.id,
        audits.audit_number,
        audits.client_id,
        audits.score,
        audits.waste_estimate,
        audits.created_at,
        audits.hubspot_portal_id,
        audits.hubspot_account_uuid,
        audit_results.snapshot_json,
        audit_results.rules_json,
        audit_results.report_json
      FROM audits
      JOIN audit_results ON audit_results.audit_id = audits.id
      WHERE audits.id = $1
      ${tenantClause}
    `,
    params
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found', 404, 'audit_report_not_found');
  }

  const row = result.rows[0];
  const reportJson = buildCompactReportJson(row.report_json || {});

  return {
    id: row.id,
    audit_number: row.audit_number,
    client_id: row.client_id,
    score: reportJson.score ?? row.score,
    health_score: reportJson.health_score ?? row.score,
    waste_estimate: reportJson.waste_estimate ?? row.waste_estimate,
    created_at: row.created_at,
    hubspot_portal_id: row.hubspot_portal_id,
    hubspot_account_uuid: row.hubspot_account_uuid,
    section_key: sectionKey,
    snapshot: buildSectionSnapshot(row.snapshot_json, sectionKey),
    rules: buildSectionRules(row.rules_json, sectionKey),
    _detail_section: sectionKey
  };
}

async function getLatestPhase1ReportByPortalId(portalId, tenantId = null) {
  const safePortalId = String(portalId);

  // Tenant-aware query: do not rely on `clients.hubspot_account_id` because it is overwritten on each connect.
  if (tenantId) {
    const result = await db.query(
      `
        SELECT audits.id
        FROM audits
        LEFT JOIN hubspot_accounts ON hubspot_accounts.id = audits.hubspot_account_uuid
        WHERE audits.tenant_id = $2
          AND COALESCE(hubspot_accounts.hubspot_account_id, audits.hubspot_portal_id) = $1
        ORDER BY audits.created_at DESC
        LIMIT 1
      `,
      [safePortalId, tenantId]
    );

    if (result.rowCount === 0) {
      throw new AppError('Audit report not found for HubSpot portal', 404, 'audit_report_not_found');
    }

    return getPhase1Report(result.rows[0].id, tenantId);
  }

  // Legacy query (no tenant context).
  const result = await db.query(
    `
      SELECT audits.id
      FROM audits
      JOIN clients ON clients.id = audits.client_id
      WHERE clients.hubspot_account_id = $1
      ORDER BY audits.created_at DESC
      LIMIT 1
    `,
    [safePortalId]
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found for HubSpot portal', 404, 'audit_report_not_found');
  }

  return getPhase1Report(result.rows[0].id, null);
}

async function getLatestPhase1ReportSummaryByPortalId(portalId, tenantId = null) {
  const safePortalId = String(portalId);

  if (tenantId) {
    const result = await db.query(
      `
        SELECT audits.id
        FROM audits
        LEFT JOIN hubspot_accounts ON hubspot_accounts.id = audits.hubspot_account_uuid
        WHERE audits.tenant_id = $2
          AND COALESCE(hubspot_accounts.hubspot_account_id, audits.hubspot_portal_id) = $1
        ORDER BY audits.created_at DESC
        LIMIT 1
      `,
      [safePortalId, tenantId]
    );

    if (result.rowCount === 0) {
      throw new AppError('Audit report not found for HubSpot portal', 404, 'audit_report_not_found');
    }

    return getPhase1ReportSummary(result.rows[0].id, tenantId);
  }

  const result = await db.query(
    `
      SELECT audits.id
      FROM audits
      JOIN clients ON clients.id = audits.client_id
      WHERE clients.hubspot_account_id = $1
      ORDER BY audits.created_at DESC
      LIMIT 1
    `,
    [safePortalId]
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found for HubSpot portal', 404, 'audit_report_not_found');
  }

  return getPhase1ReportSummary(result.rows[0].id, null);
}

async function getLatestPhase1ReportObjectByPortalId(portalId, objectType, tenantId = null) {
  const safePortalId = String(portalId);

  if (tenantId) {
    const result = await db.query(
      `
        SELECT audits.id
        FROM audits
        LEFT JOIN hubspot_accounts ON hubspot_accounts.id = audits.hubspot_account_uuid
        WHERE audits.tenant_id = $2
          AND COALESCE(hubspot_accounts.hubspot_account_id, audits.hubspot_portal_id) = $1
        ORDER BY audits.created_at DESC
        LIMIT 1
      `,
      [safePortalId, tenantId]
    );

    if (result.rowCount === 0) {
      throw new AppError('Audit report not found for HubSpot portal', 404, 'audit_report_not_found');
    }

    return getPhase1ReportObject(result.rows[0].id, objectType, tenantId);
  }

  const result = await db.query(
    `
      SELECT audits.id
      FROM audits
      JOIN clients ON clients.id = audits.client_id
      WHERE clients.hubspot_account_id = $1
      ORDER BY audits.created_at DESC
      LIMIT 1
    `,
    [safePortalId]
  );

  if (result.rowCount === 0) {
    throw new AppError('Audit report not found for HubSpot portal', 404, 'audit_report_not_found');
  }

  return getPhase1ReportObject(result.rows[0].id, objectType, null);
}

async function listPhase1Reports(tenantId, options = {}) {
  if (!tenantId) {
    throw new AppError('Authentication required', 401, 'authentication_required');
  }

  const summaryOnly = Boolean(options && options.summaryOnly);

  if (summaryOnly) {
    const result = await db.query(
      `
        SELECT
          audits.id,
          audits.audit_number,
          audits.score,
          audits.waste_estimate,
          audits.created_at,
          COALESCE(hubspot_accounts.hubspot_account_id, audits.hubspot_portal_id) AS hubspot_portal_id,
          COALESCE(NULLIF(audit_results.rules_json->>'issue_count', '')::int, 0) AS issue_count
        FROM audits
        LEFT JOIN hubspot_accounts ON hubspot_accounts.id = audits.hubspot_account_uuid
        LEFT JOIN audit_results ON audit_results.audit_id = audits.id
        WHERE audits.tenant_id = $1
        ORDER BY audits.created_at DESC
        LIMIT 50
      `,
      [tenantId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      audit_number: row.audit_number,
      score: row.score,
      health_score: row.score,
      waste_estimate: row.waste_estimate,
      created_at: row.created_at,
      hubspot_portal_id: row.hubspot_portal_id,
      issue_count: Number(row.issue_count || 0)
    }));
  }

  const result = await db.query(
    `
      SELECT
        audits.id,
        audits.audit_number,
        audits.score,
        audits.waste_estimate,
        audits.created_at,
        COALESCE(hubspot_accounts.hubspot_account_id, audits.hubspot_portal_id) AS hubspot_portal_id,
        audit_results.rules_json,
        audit_results.report_json
      FROM audits
      LEFT JOIN hubspot_accounts ON hubspot_accounts.id = audits.hubspot_account_uuid
      JOIN audit_results ON audit_results.audit_id = audits.id
      WHERE audits.tenant_id = $1
      ORDER BY audits.created_at DESC
      LIMIT 50
    `,
      [tenantId]
    );

  return result.rows.map((row) => ({
    id: row.id,
    audit_number: row.audit_number,
    score: row.score,
    health_score: row.report_json && typeof row.report_json.health_score !== 'undefined'
      ? row.report_json.health_score
      : row.score,
    score_label: row.report_json && row.report_json.score_label ? row.report_json.score_label : null,
    scope_label: row.report_json && row.report_json.scope_label ? row.report_json.scope_label : null,
    scope: row.report_json && Array.isArray(row.report_json.scope) ? row.report_json.scope : null,
    waste_estimate: row.waste_estimate,
    created_at: row.created_at,
    hubspot_portal_id: row.hubspot_portal_id,
    issue_count: row.rules_json.issue_count || 0,
    by_category: row.rules_json.by_category || {},
    critical_issues: row.report_json && row.report_json.critical_issues ? row.report_json.critical_issues : 0,
    high_issues: row.report_json && row.report_json.high_issues ? row.report_json.high_issues : 0
  }));
}

async function generateAiForReport(auditId, tenantId, options = {}) {
  if (!tenantId) {
    throw new AppError('Authentication required', 401, 'authentication_required');
  }

  const requestedMode = normalizePromptMode(options.aiPromptMode);
  const requestedObjectType = normalizeAiObjectType(options.aiObjectType || options.objectType);
  const requestedObjectLabel = options.aiObjectLabel || options.objectLabel || requestedObjectType || null;
  const row = await loadAuditAiContext(auditId, tenantId);
  if (!row) {
    throw new AppError('Audit report not found', 404, 'audit_report_not_found');
  }

  const reportJson = row.report_json || {};
  const variant = getAiVariant(reportJson, requestedMode, requestedObjectType);
  const job = getAiJob(reportJson, requestedMode, requestedObjectType);

  if (variant) {
    const cacheMetrics = {
      input_chars: 0,
      output_chars: 0,
      cache_hit: true,
      ai_cost: 0,
      total_cost: 0
    };
    await recordCostFromMetrics(row.id, cacheMetrics, requestedMode);
    return {
      id: row.id,
      hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
      ai: variant,
      ai_error: null,
      ai_prompt_mode: requestedMode,
      ai_score: reportJson.ai_score || calculateAiScore(reportJson.score, variant),
      ai_status: 'complete',
      cached: true,
      ai_metrics: cacheMetrics,
      ...(requestedObjectType ? { ai_object_type: requestedObjectType } : {})
    };
  }

  const snapshot = row.snapshot_json;
  const rules = row.rules_json || {};
  const aiIssues = normalizeIssuesForAi(rules.issues)
    .filter((issue) => issueMatchesObjectType(issue, requestedObjectType))
    .slice(0, 40);
  const allowQueuedFullAnalysis = requestedMode === 'full' && !requestedObjectType;

  let aiError = null;
  if (allowQueuedFullAnalysis) {
    const aiPreview = await safeCall(
      () => resolveOptimizedAiAnalysis(snapshot, aiIssues, requestedMode, {
        auditId: Number(auditId),
        deferAnalysis: true
      }),
      null,
      (error) => {
        aiError = {
          code: error.code || 'ai_failed',
          message: error.message || 'AI analysis failed',
          details: error.details || null
        };
        logger.error('AI cache check failed for report regeneration', {
          auditId: Number(auditId),
          mode: requestedMode,
          stack: error.stack
        });
      }
    );

    if (aiPreview && aiPreview.ai) {
      const nextReport = buildAiReportState(reportJson, requestedMode, {
        ai: aiPreview.ai,
        ai_status: 'complete',
        ai_score: calculateAiScore(reportJson.score, aiPreview.ai),
        started_at: nowIso(),
        completed_at: nowIso(),
        cached: Boolean(aiPreview.cached),
        skipped: Boolean(aiPreview.skipped),
        ai_metrics: aiPreview.metrics || null,
        ...(requestedObjectType ? { objectType: requestedObjectType } : {})
      });

      await persistReportJson(row.id, nextReport);
      await recordCostFromMetrics(row.id, aiPreview.metrics, requestedMode);

      return {
        id: row.id,
        hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
        ai: aiPreview.ai,
        ai_error: null,
        ai_prompt_mode: requestedMode,
        ai_score: calculateAiScore(reportJson.score, aiPreview.ai),
        ai_status: 'complete',
        cached: Boolean(aiPreview.cached),
        skipped: Boolean(aiPreview.skipped),
        ai_metrics: aiPreview.metrics || null,
        ...(requestedObjectType ? { ai_object_type: requestedObjectType } : {})
      };
    }

    if (!aiPreview || aiPreview.needs_analysis) {
      if (aiIssues.length === 0) {
        const noIssueAi = buildNoIssueAiResult(snapshot, {
          objectType: requestedObjectType,
          objectLabel: requestedObjectLabel
        });
        const nextReport = buildAiReportState(reportJson, requestedMode, {
          ai: noIssueAi,
          ai_status: 'complete',
          ai_score: calculateAiScore(reportJson.score, noIssueAi),
          started_at: nowIso(),
          completed_at: nowIso(),
          cached: true,
          skipped: true,
          ...(requestedObjectType ? { objectType: requestedObjectType } : {}),
          ai_metrics: {
            input_chars: 0,
            output_chars: 0,
            cache_hit: true,
            ai_cost: 0,
            total_cost: 0
          }
        });

        await persistReportJson(row.id, nextReport);
        await recordCostFromMetrics(row.id, nextReport.ai_metrics, requestedMode);

        return {
          id: row.id,
          hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
          ai: noIssueAi,
          ai_error: null,
          ai_prompt_mode: requestedMode,
          ai_score: calculateAiScore(reportJson.score, noIssueAi),
          ai_status: 'complete',
          cached: true,
          skipped: true,
          ai_metrics: nextReport.ai_metrics,
          ...(requestedObjectType ? { ai_object_type: requestedObjectType } : {})
        };
      }

      if (job && (job.status === 'running' || job.status === 'queued')) {
        return {
          id: row.id,
          hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
          ai: variant || null,
          ai_error: null,
          ai_prompt_mode: requestedMode,
          ai_score: reportJson.ai_score || (variant ? calculateAiScore(reportJson.score, variant) : null),
          ai_status: job.status,
          cached: Boolean(variant),
          ...(requestedObjectType ? { ai_object_type: requestedObjectType } : {})
        };
      }

      if (requestedObjectType) {
        const aiScopedOutcome = await safeCall(
          () => resolveOptimizedAiAnalysis(snapshot, aiIssues, requestedMode, {
            auditId: Number(auditId),
            aiObjectType: requestedObjectType,
            aiObjectLabel: requestedObjectLabel
          }),
          null,
          (error) => {
            aiError = {
              code: error.code || 'ai_failed',
              message: error.message || 'AI analysis failed',
              details: error.details || null
            };
            logger.error('AI analysis failed for scoped report regeneration', {
              auditId: Number(auditId),
              mode: requestedMode,
              objectType: requestedObjectType,
              stack: error.stack
            });
          }
        );

        const scopedAi = aiScopedOutcome ? aiScopedOutcome.ai : null;
        const scopedReport = buildAiReportState(reportJson, requestedMode, {
          ai: scopedAi,
          ai_error: aiError,
          ai_status: scopedAi ? 'complete' : 'error',
          ai_score: scopedAi ? calculateAiScore(reportJson.score, scopedAi) : null,
          started_at: nowIso(),
          completed_at: nowIso(),
          ai_metrics: aiScopedOutcome ? aiScopedOutcome.metrics || null : null,
          objectType: requestedObjectType
        });

        if (!scopedAi) {
          scopedReport.ai_error = aiError;
        } else if (scopedReport.ai_error) {
          delete scopedReport.ai_error;
        }

        await persistReportJson(row.id, scopedReport);
        await recordCostFromMetrics(row.id, aiScopedOutcome ? aiScopedOutcome.metrics : null, requestedMode);

        return {
          id: row.id,
          hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
          ai: scopedAi,
          ai_error: aiError,
          ai_prompt_mode: scopedAi ? requestedMode : getCurrentAiMode(reportJson),
          ai_score: scopedAi ? calculateAiScore(reportJson.score, scopedAi) : reportJson.ai_score || null,
          ai_status: scopedAi ? 'complete' : 'error',
          cached: Boolean(aiScopedOutcome && aiScopedOutcome.cached),
          skipped: Boolean(aiScopedOutcome && aiScopedOutcome.skipped),
          ai_metrics: aiScopedOutcome ? aiScopedOutcome.metrics || null : null,
          ai_object_type: requestedObjectType
        };
      }

      await markAiJobQueued(row.id, requestedMode);
      queueAiBackgroundJob({
        auditId: row.id,
        tenantId,
        snapshot: row.snapshot_json,
        rules: row.rules_json || {}
      });

      return {
        id: row.id,
        hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
        ai: null,
        ai_error: null,
        ai_prompt_mode: requestedMode,
        ai_score: null,
        ai_status: 'running',
        queued: true
      };
    }
  }
  const aiOutcome = await safeCall(
    () => resolveOptimizedAiAnalysis(snapshot, aiIssues, requestedMode, {
      auditId: Number(auditId),
      aiObjectType: requestedObjectType,
      aiObjectLabel: requestedObjectLabel
    }),
    null,
    (error) => {
      aiError = {
        code: error.code || 'ai_failed',
        message: error.message || 'AI analysis failed',
        details: error.details || null
      };
      logger.error('AI analysis failed for report regeneration', {
        auditId: Number(auditId),
        mode: requestedMode,
        stack: error.stack
      });
    }
  );

  const ai = aiOutcome ? aiOutcome.ai : null;

  const nextReport = buildAiReportState(reportJson, requestedMode, {
    ai,
    ai_error: aiError,
    ai_status: ai ? 'complete' : 'error',
    ai_score: ai ? calculateAiScore(reportJson.score, ai) : null,
    started_at: nowIso(),
    completed_at: nowIso(),
    ai_metrics: aiOutcome ? aiOutcome.metrics || null : null,
    ...(requestedObjectType ? { objectType: requestedObjectType } : {})
  });

  if (!ai) {
    nextReport.ai_error = aiError;
  } else if (nextReport.ai_error) {
    delete nextReport.ai_error;
  }

  await persistReportJson(row.id, nextReport);
  await recordCostFromMetrics(row.id, aiOutcome ? aiOutcome.metrics : null, requestedMode);

  return {
    id: row.id,
    hubspot_portal_id: row.hubspot_portal_id ? String(row.hubspot_portal_id) : null,
    ai,
    ai_error: aiError,
    ai_prompt_mode: ai ? requestedMode : getCurrentAiMode(reportJson),
    ai_score: ai ? calculateAiScore(reportJson.score, ai) : reportJson.ai_score || null,
    ai_status: ai ? 'complete' : 'error',
    cached: Boolean(aiOutcome && aiOutcome.cached),
    skipped: Boolean(aiOutcome && aiOutcome.skipped),
    ai_metrics: aiOutcome ? aiOutcome.metrics || null : null,
    ...(requestedObjectType ? { ai_object_type: requestedObjectType } : {})
  };
}

async function loadAuditAiContext(auditId, tenantId) {
  const result = await db.query(
    `
      SELECT
        audits.id,
        audits.tenant_id,
        audits.hubspot_portal_id,
        audit_results.snapshot_json,
        audit_results.rules_json,
        audit_results.report_json
      FROM audits
      JOIN audit_results ON audit_results.audit_id = audits.id
      WHERE audits.id = $1
        AND (audits.tenant_id = $2 OR audits.tenant_id IS NULL)
      LIMIT 1
    `,
    [Number(auditId), tenantId]
  );

  return result.rowCount > 0 ? result.rows[0] : null;
}

async function markAiJobQueued(auditId, mode, objectType = null) {
  const row = await db.query(
    `
      SELECT report_json
      FROM audit_results
      WHERE audit_id = $1
      LIMIT 1
    `,
    [Number(auditId)]
  );

  if (row.rowCount === 0) return;

  const reportJson = row.rows[0].report_json || {};
  const nextReport = buildAiReportState(reportJson, mode, {
    ai_status: 'queued',
    started_at: nowIso(),
    ...(normalizeAiObjectType(objectType) ? { objectType: normalizeAiObjectType(objectType) } : {})
  });

  await persistReportJson(auditId, nextReport);
}

function queueAiBackgroundJob({ auditId, tenantId, snapshot, rules, mode = 'full', objectType = null, objectLabel = null }) {
  const normalizedMode = normalizePromptMode(mode);
  const normalizedObjectType = normalizeAiObjectType(objectType);
  const jobKey = aiJobKey(auditId, normalizedMode, normalizedObjectType);
  if (aiQueue.isQueued(jobKey)) {
    return;
  }

  aiQueue.enqueue(jobKey, async () => {
    const requestedMode = normalizedMode;
    let aiError = null;
    const aiIssues = normalizeIssuesForAi(rules.issues)
      .filter((issue) => issueMatchesObjectType(issue, normalizedObjectType))
      .slice(0, 40);
    const aiOutcome = await safeCall(
      () => resolveOptimizedAiAnalysis(snapshot, aiIssues, requestedMode, {
        auditId,
        aiObjectType: normalizedObjectType,
        aiObjectLabel: objectLabel || objectAiLabel(normalizedObjectType)
      }),
      null,
      (error) => {
        aiError = {
          code: error.code || 'ai_failed',
          message: error.message || 'AI analysis failed',
          details: error.details || null
        };
        logger.error('Background AI analysis failed', {
          stack: error.stack,
          auditId,
          mode: requestedMode
        });
      }
    );
    const ai = aiOutcome ? aiOutcome.ai : null;

    const latest = await loadAuditAiContext(auditId, tenantId);
    if (!latest) return;

    const latestReport = latest.report_json || {};
    const nextReport = buildAiReportState(latestReport, requestedMode, {
      ...(ai ? { ai } : {}),
      ...(aiError ? { ai_error: aiError } : { clear_ai_error: true }),
      ai_status: ai ? 'complete' : 'error',
      ai_score: ai ? calculateAiScore(latestReport.score, ai) : null,
      started_at: nowIso(),
      completed_at: nowIso(),
      cached: Boolean(aiOutcome && aiOutcome.cached),
      skipped: Boolean(aiOutcome && aiOutcome.skipped),
      ai_metrics: aiOutcome ? aiOutcome.metrics || null : null,
      ...(normalizedObjectType ? { objectType: normalizedObjectType } : {})
    });

    await persistReportJson(auditId, nextReport);
    await recordCostFromMetrics(auditId, aiOutcome ? aiOutcome.metrics : null, requestedMode);
  });
}

module.exports = {
  runHubSpotAudit,
  runRules,
  runPhase1Audit,
  getPhase1Report,
  getPhase1ReportSummary,
  getPhase1ReportObject,
  getPhase1ReportDetailSection,
  getLatestPhase1ReportByPortalId,
  getLatestPhase1ReportSummaryByPortalId,
  getLatestPhase1ReportObjectByPortalId,
  listPhase1Reports,
  generateAiForReport
};
