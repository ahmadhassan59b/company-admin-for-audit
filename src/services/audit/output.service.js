const RISK_POINTS = {
  critical: 15,
  high: 8,
  medium: 4,
  low: 1,
  info: 0
};

const RISK_CAPS = {
  critical: 45,
  high: 35,
  medium: 20,
  low: 10,
  info: 0
};

const OBJECT_BREAKDOWN_SPECS = [
  {
    objectType: 'contacts',
    label: 'Contacts',
    filters: ['contacts'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'companies',
    label: 'Companies',
    filters: ['companies'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'deals',
    label: 'Deals',
    filters: ['deals', 'pipelines'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'workflows',
    label: 'Workflows',
    filters: ['workflows', 'automation'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'forms',
    label: 'Forms',
    filters: ['forms'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'emails',
    label: 'Emails',
    filters: ['emails'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'lists',
    label: 'Lists',
    filters: ['lists'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'properties',
    label: 'Properties',
    filters: ['properties', 'data_cleanliness'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'pipelines',
    label: 'Pipelines',
    filters: ['pipelines'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'owners',
    label: 'Owners',
    filters: ['owners', 'usage'],
    available: true,
    unavailableLabel: null
  },
  {
    objectType: 'associations',
    label: 'Associations',
    filters: ['associations'],
    available: true,
    unavailableLabel: null
  }
];

function normalizeIssues(issues) {
  return Array.isArray(issues) ? issues.filter(Boolean) : [];
}

function normalizeRiskLevel(value) {
  const severity = String(value || 'low').toLowerCase();
  if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low' || severity === 'info') {
    return severity;
  }
  return 'low';
}

function normalizeObjectType(value) {
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
  return 'properties';
}

function severityScore(riskLevel) {
  const level = normalizeRiskLevel(riskLevel);
  return RISK_POINTS[level] || 0;
}

function defaultRecommendation(objectType, riskLevel) {
  const type = normalizeObjectType(objectType);
  const severity = normalizeRiskLevel(riskLevel);
  if (severity === 'info') {
    return 'Review periodically to keep the workspace tidy.';
  }
  if (type === 'contacts') {
    return 'Review contact records for missing identity and lifecycle data so segmentation and automation stay reliable.';
  }
  if (type === 'companies') {
    return 'Review company records for missing naming and domain data so account reporting stays trustworthy.';
  }
  if (type === 'emails') {
    return 'Review email engagement records for missing subjects or timestamps so tracking stays dependable.';
  }
  if (type === 'deals') {
    return 'Review deal records for missing names, owners, stages, or company links so forecast data stays reliable.';
  }
  if (type === 'workflows') {
    return 'Review inactive workflows and keep only the automations that still support the funnel.';
  }
  if (type === 'pipelines' || type === 'deals') {
    return 'Trim stale deal motion and keep pipeline stages aligned to how reps actually sell.';
  }
  if (type === 'forms') {
    return 'Retire low-usage forms and keep only the forms that still support active campaigns.';
  }
  if (type === 'properties' || type === 'contacts') {
    return 'Consolidate duplicate properties and remove fields that no longer support reporting or automation.';
  }
  if (type === 'owners') {
    return 'Review unused seats and align ownership with active users only.';
  }
  return 'Review this area and remove unused configuration where possible.';
}

function extractAiRecommendations(ai) {
  if (!ai || typeof ai !== 'object') return [];

  const strategic = Array.isArray(ai.strategic_recommendations) ? ai.strategic_recommendations : [];
  const quickWins = Array.isArray(ai.quick_wins) ? ai.quick_wins : [];

  return Array.from(
    new Set(
      [...strategic, ...quickWins]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 3);
}

function defaultImpact(objectType, riskLevel) {
  const type = normalizeObjectType(objectType);
  const severity = normalizeRiskLevel(riskLevel);
  if (severity === 'info') {
    return 'This is informational and does not currently increase audit risk.';
  }
  if (type === 'contacts') {
    return 'Missing contact identity or lifecycle data makes segmentation, routing, and reporting less reliable.';
  }
  if (type === 'companies') {
    return 'Missing company identity or domain data weakens account-based reporting and deduplication.';
  }
  if (type === 'emails') {
    return 'Missing email metadata makes engagement tracking and reporting less dependable.';
  }
  if (type === 'deals') {
    return 'Missing deal fields weaken pipeline forecasting, owner accountability, and stage movement analysis.';
  }
  if (type === 'workflows') {
    return 'Automation gaps can slow lead response and lifecycle handoffs.';
  }
  if (type === 'pipelines' || type === 'deals') {
    return 'Deal movement can become harder to manage and forecast.';
  }
  if (type === 'forms') {
    return 'Unused forms create clutter and can hide conversion issues.';
  }
  if (type === 'properties' || type === 'contacts') {
    return 'A large or messy property model makes reporting and automation harder to trust.';
  }
  if (type === 'owners') {
    return 'Inactive seats can hide ownership gaps and reduce portal clarity.';
  }
  return 'This area should be reviewed to reduce configuration overhead.';
}

function deriveObjectType(category, meta = {}) {
  if (meta.objectType) return normalizeObjectType(meta.objectType);

  const normalized = String(category || '').toLowerCase();
  if (normalized === 'deals') return 'deals';
  if (normalized === 'contacts') return 'contacts';
  if (normalized === 'companies') return 'companies';
  if (normalized === 'emails') return 'emails';
  if (normalized === 'lists') return 'lists';
  if (normalized === 'associations') return 'associations';
  if (normalized === 'pipelines') return 'pipelines';
  if (normalized === 'workflows') return 'workflows';
  if (normalized === 'forms') return 'forms';
  if (normalized === 'usage') return 'owners';
  if (normalized === 'data_cleanliness') return 'properties';
  return 'properties';
}

function deriveObjectGroup(category, objectType) {
  if (category === 'deals' || objectType === 'deals') return 'deals';
  if (category === 'contacts' || objectType === 'contacts') return 'contacts';
  if (category === 'companies' || objectType === 'companies') return 'companies';
  if (category === 'emails' || objectType === 'emails') return 'emails';
  if (category === 'lists' || objectType === 'lists') return 'lists';
  if (category === 'associations' || objectType === 'associations') return 'associations';
  if (category === 'pipelines' || objectType === 'pipelines') return 'deals';
  if (category === 'data_cleanliness' || objectType === 'properties') return 'contacts';
  if (category === 'usage' || objectType === 'owners') return 'owners';
  return objectType;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildIssueId(issue, objectType) {
  const parts = [
    objectType,
    issue.category || 'general',
    issue.workflow_id || issue.pipeline_id || issue.form_id || issue.id || '',
    issue.deal_id || '',
    issue.contact_id || issue.company_id || issue.email_id || '',
    issue.title || issue.message || issue.detail || ''
  ]
    .map((value) => slugify(value))
    .filter(Boolean);
  return parts.join('-') || `issue-${Date.now()}`;
}

function inferAffectedCount(issue) {
  const candidates = [
    issue.affectedCount,
    issue.unused_users,
    issue.custom_properties,
    issue.stale_deals,
    issue.forms_without_submissions,
    issue.form_count
  ];

  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
  }

  return null;
}

function normalizeIssue(issue) {
  const objectType = deriveObjectType(issue.category, issue);
  const riskLevel = normalizeRiskLevel(issue.riskLevel || issue.severity);
  const title = String(issue.title || issue.message || 'Untitled issue');
  const description = String(issue.description || issue.detail || issue.message || title);
  const recommendation = String(issue.recommendation || defaultRecommendation(objectType, riskLevel));
  const impact = String(issue.impact || defaultImpact(objectType, riskLevel));

  return {
    id: issue.id || buildIssueId(issue, objectType),
    objectType,
    objectGroup: deriveObjectGroup(issue.category, objectType),
    category: issue.category || objectType,
    title,
    description,
    impact,
    recommendation,
    riskLevel,
    severity: riskLevel,
    severityScore: Number.isFinite(Number(issue.severityScore))
      ? Number(issue.severityScore)
      : severityScore(riskLevel),
    affectedCount: inferAffectedCount(issue),
    sampleRecords: Array.isArray(issue.sampleRecords) ? issue.sampleRecords.slice(0, 5) : [],
    source: issue.source || 'rule_engine',
    message: String(issue.message || title),
    workflow_id: issue.workflow_id || null,
    pipeline_id: issue.pipeline_id || null,
    deal_id: issue.deal_id || null,
    form_id: issue.form_id || null,
    unused_users: issue.unused_users || null,
    custom_properties: issue.custom_properties || null,
    stale_ratio: issue.stale_ratio || null
  };
}

function summarizeIssueCounts(issues) {
  return normalizeIssues(issues).reduce(
    (acc, issue) => {
      const riskLevel = normalizeRiskLevel(issue.riskLevel || issue.severity);
      const point = Number.isFinite(Number(issue.severityScore))
        ? Math.max(0, Number(issue.severityScore))
        : RISK_POINTS[riskLevel] || 0;
      acc.totalIssues += 1;
      acc[riskLevel + 'Issues'] += 1;
      acc.rawPenalty += point;
      acc.rawPenaltyByLevel[riskLevel] += point;
      return acc;
    },
    {
      totalIssues: 0,
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      lowIssues: 0,
      infoIssues: 0,
      rawPenalty: 0,
      rawPenaltyByLevel: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      }
    }
  );
}

function scoreLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Healthy';
  if (score >= 60) return 'Needs Attention';
  if (score >= 40) return 'At Risk';
  return 'Critical';
}

function scoreRiskLevel(score) {
  if (score >= 75) return 'low';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'high';
  return 'critical';
}

function scoreSummaryText(score, counts = {}) {
  const critical = Number(counts.criticalIssues || 0);
  const high = Number(counts.highIssues || 0);
  const medium = Number(counts.mediumIssues || 0);

  if (score >= 90) {
    return 'This HubSpot portal looks excellent with only a few low-risk findings.';
  }

  if (score >= 75) {
    return 'This HubSpot portal looks healthy with mostly low-risk findings.';
  }

  if (score >= 60) {
    return high > 0
      ? 'This HubSpot portal needs attention due to several high-risk issues.'
      : 'This HubSpot portal needs attention due to several medium-risk issues.';
  }

  if (score >= 40) {
    return critical > 0
      ? 'This HubSpot portal is at risk because critical issues need immediate review.'
      : 'This HubSpot portal is at risk because several high-risk issues need review.';
  }

  return critical > 0
    ? 'This HubSpot portal needs urgent attention because critical issues were found.'
    : 'This HubSpot portal needs urgent attention because multiple high-risk issues were found.';
}

function calculateHealthScore(issues) {
  const summary = summarizeIssueCounts(issues);
  const penaltyByLevel = Object.entries(summary.rawPenaltyByLevel).reduce(
    (acc, [level, penalty]) => {
      acc[level] = Math.min(penalty, RISK_CAPS[level] || 0);
      return acc;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    }
  );
  const totalPenalty = Object.entries(penaltyByLevel).reduce(
    (sum, [, penalty]) => sum + penalty,
    0
  );
  const healthScore = Math.max(0, Math.min(100, 100 - totalPenalty));

  return {
    healthScore,
    scoreLabel: scoreLabel(healthScore),
    riskLevel: scoreRiskLevel(healthScore),
    totalIssues: summary.totalIssues,
    criticalIssues: summary.criticalIssues,
    highIssues: summary.highIssues,
    mediumIssues: summary.mediumIssues,
    lowIssues: summary.lowIssues,
    infoIssues: summary.infoIssues,
    totalPenalty,
    rawPenalty: summary.rawPenalty,
    rawPenaltyByLevel: summary.rawPenaltyByLevel,
    penaltyByLevel,
    scoreSummary: {
      formula: '100 - capped severity penalties',
      points: RISK_POINTS,
      caps: RISK_CAPS,
      text: scoreSummaryText(healthScore, summary),
      label: scoreLabel(healthScore),
      riskLevel: scoreRiskLevel(healthScore),
      totalIssues: summary.totalIssues,
      issueCounts: {
        critical: summary.criticalIssues,
        high: summary.highIssues,
        medium: summary.mediumIssues,
        low: summary.lowIssues,
        info: summary.infoIssues
      },
      rawPenalty: summary.rawPenalty,
      rawPenaltyByLevel: summary.rawPenaltyByLevel,
      penaltyByLevel,
      totalPenalty,
      healthScore,
      scoreLabel: scoreLabel(healthScore)
    }
  };
}

function matchesFilters(issue, filters) {
  const normalized = normalizeIssue(issue);
  const values = [normalized.objectType, normalized.objectGroup, normalized.category]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return filters.some((filter) => values.includes(String(filter).toLowerCase()));
}

function buildCardSummary(spec, issues, scope = null) {
  if (!isScopeSelected(scope, spec.objectType)) {
    const summaryText = 'Not included in selected audit scope';
    return {
      objectType: spec.objectType,
      label: spec.label,
      health_score: null,
      score: null,
      scoreLabel: null,
      score_label: null,
      score_summary: null,
      totalIssues: 0,
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      lowIssues: 0,
      infoIssues: 0,
      highestRiskLevel: 'info',
      highestRisk: 'info',
      summary: summaryText,
      quickSummary: summaryText,
      available: false,
      sourceStatus: 'not_requested'
    };
  }

  const matched = issues.filter((issue) => matchesFilters(issue, spec.filters || []));
  const available = spec.available !== false;

  if (!available) {
    const summaryText = spec.unavailableLabel || 'Not fetched yet';
    return {
      objectType: spec.objectType,
      label: spec.label,
      health_score: null,
      score: null,
      scoreLabel: null,
      score_label: null,
      score_summary: null,
      totalIssues: 0,
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      lowIssues: 0,
      infoIssues: 0,
      highestRiskLevel: 'info',
      highestRisk: 'info',
      summary: summaryText,
      quickSummary: summaryText,
      available: false,
      sourceStatus: 'unavailable'
    };
  }

  const summary = calculateHealthScore(matched);
  const highestRiskLevel =
    summary.criticalIssues > 0
      ? 'critical'
      : summary.highIssues > 0
        ? 'high'
        : summary.mediumIssues > 0
          ? 'medium'
          : summary.lowIssues > 0
            ? 'low'
            : 'info';

  const quickSummary = summary.totalIssues
    ? `${summary.totalIssues} issue${summary.totalIssues === 1 ? '' : 's'} across ${spec.label.toLowerCase()}`
    : `No active issues found for ${spec.label.toLowerCase()}`;

  return {
    objectType: spec.objectType,
    label: spec.label,
    health_score: summary.healthScore,
    score: summary.healthScore,
    scoreLabel: summary.scoreLabel,
    score_label: summary.scoreLabel,
    score_summary: summary.scoreSummary,
    summary: summary.scoreSummary && summary.scoreSummary.text ? summary.scoreSummary.text : quickSummary,
    totalIssues: summary.totalIssues,
    criticalIssues: summary.criticalIssues,
    highIssues: summary.highIssues,
    mediumIssues: summary.mediumIssues,
    lowIssues: summary.lowIssues,
    infoIssues: summary.infoIssues,
    highestRiskLevel,
    highestRisk: highestRiskLevel,
    quickSummary,
    available: true,
    sourceStatus: 'available'
  };
}

function buildObjectBreakdown(issues, scope = null) {
  const normalized = normalizeIssues(issues).map(normalizeIssue);
  return OBJECT_BREAKDOWN_SPECS.map((spec) => buildCardSummary(spec, normalized, scope));
}

function isScopeSelected(scope, objectType) {
  const selected = new Set(
    (Array.isArray(scope) ? scope : [])
      .map((value) => String(value || '').toLowerCase())
      .filter(Boolean)
  );

  if (!selected.size || selected.has('full') || selected.has('all')) {
    return true;
  }

  const normalized = normalizeObjectType(objectType);
  if (selected.has(normalized)) return true;
  if (normalized === 'deals' && selected.has('pipelines')) return true;
  if (normalized === 'pipelines' && selected.has('deals')) return true;
  if (normalized === 'properties' && (selected.has('contacts') || selected.has('properties'))) return true;
  return false;
}

function sortIssuesByRisk(issues) {
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return normalizeIssues(issues)
    .map(normalizeIssue)
    .sort((a, b) => {
      const severityDiff = (rank[a.riskLevel] ?? 4) - (rank[b.riskLevel] ?? 4);
      if (severityDiff !== 0) return severityDiff;
      const countDiff = Number(b.affectedCount || 0) - Number(a.affectedCount || 0);
      if (countDiff !== 0) return countDiff;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
}

function buildRiskSummary(issues) {
  return normalizeIssues(issues).map(normalizeIssue).reduce(
    (acc, issue) => {
      const risk = normalizeRiskLevel(issue.riskLevel || issue.severity);
      acc[risk] += 1;
      return acc;
    },
    {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    }
  );
}

function buildExecutiveSummary(issues, healthSummary, scoreLabelValue, scope = null, context = {}) {
  const sorted = sortIssuesByRisk(issues);
  const riskSummary = context && context.riskSummary ? context.riskSummary : null;
  const objectBreakdown = Array.isArray(context && context.objectBreakdown) ? context.objectBreakdown : [];
  const aiRecommendations = extractAiRecommendations(context && context.ai);
  const weakestObjects = objectBreakdown
    .filter((item) => item && typeof item === 'object')
    .filter((item) => Number.isFinite(Number(item.score)))
    .slice()
    .sort((a, b) => Number(a.score) - Number(b.score))
    .slice(0, 3);

  const topRisks = sorted.slice(0, 3).map((issue) => issue.title).filter(Boolean);
  const ruleBasedNextSteps = Array.from(
    new Set(
      sorted
        .slice(0, 5)
        .map((issue) => issue.recommendation)
        .filter(Boolean)
    )
  ).slice(0, 3);

  const fallbackObjectSteps = weakestObjects.map(
    (item) => `Review ${String(item.label || item.objectType || 'this area').toLowerCase()} hygiene first`
  );

  const nextStepsWithObjects = Array.from(
    new Set([
      ...aiRecommendations,
      ...ruleBasedNextSteps,
      ...fallbackObjectSteps
    ])
  ).slice(0, 3);

  const healthLabel = scoreLabelValue || scoreLabel(healthSummary.healthScore);
  let headline = 'Your HubSpot portal needs attention';
  if (healthSummary.healthScore >= 90) headline = 'Your HubSpot portal looks excellent';
  else if (healthSummary.healthScore >= 75) headline = 'Your HubSpot portal looks healthy';
  else if (healthSummary.healthScore >= 60) headline = 'Your HubSpot portal needs attention';
  else if (healthSummary.healthScore >= 40) headline = 'Your HubSpot portal is at risk';
  else headline = 'Your HubSpot portal needs urgent attention';

  const scopeText = Array.isArray(scope) && scope.length
    ? ` for the selected scope (${scope.map((item) => String(item)).join(', ')})`
    : '';

  const riskBits = [];
  if (riskSummary) {
    const critical = Number(riskSummary.critical || riskSummary.criticalIssues || 0);
    const high = Number(riskSummary.high || riskSummary.highIssues || 0);
    const medium = Number(riskSummary.medium || riskSummary.mediumIssues || 0);
    if (critical || high || medium) {
      const pieces = [
        critical ? `${critical} critical` : null,
        high ? `${high} high` : null,
        medium ? `${medium} medium` : null
      ].filter(Boolean);
      if (pieces.length) {
        riskBits.push(`The audit found ${pieces.join(', ')} issue${pieces.length > 1 ? 's' : ''}.`);
      }
    }
  }

  const weakestSummary = weakestObjects.length
    ? `The weakest areas are ${weakestObjects.map((item) => String(item.label || item.objectType || 'unknown')).join(', ')}.`
    : '';

  return {
    headline,
    summary: [
      `${healthSummary.totalIssues} issue${healthSummary.totalIssues === 1 ? '' : 's'} were found${scopeText}.`,
      riskBits.length ? riskBits.join(' ') : '',
      weakestSummary,
      `The portal is currently rated ${healthLabel}.`
    ]
      .filter(Boolean)
      .join(' '),
    topRisks,
    top_risks: topRisks,
    recommendedNextSteps: nextStepsWithObjects,
    recommended_next_steps: nextStepsWithObjects,
    recommendedNextStepsSource: aiRecommendations.length ? 'ai' : 'rules'
  };
}

function buildRiskSections(issues) {
  const grouped = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: []
  };

  sortIssuesByRisk(issues).forEach((issue) => {
    const level = normalizeRiskLevel(issue.riskLevel || issue.severity);
    grouped[level].push(issue);
  });

  return [
    { riskLevel: 'critical', label: 'Critical Issues', issues: grouped.critical },
    { riskLevel: 'high', label: 'High Priority Issues', issues: grouped.high },
    { riskLevel: 'medium', label: 'Medium Priority Issues', issues: grouped.medium },
    { riskLevel: 'low', label: 'Low Priority Issues', issues: grouped.low },
    { riskLevel: 'info', label: 'Informational Findings', issues: grouped.info }
  ].map((section) => ({
    ...section,
    count: section.issues.length,
    summary:
      section.issues.length > 0
        ? `${section.issues.length} issue${section.issues.length === 1 ? '' : 's'}`
        : 'No findings'
  }));
}

function buildProductizedAuditOutput(snapshot, rules, score, ai = null) {
  const issues = normalizeIssues(rules && rules.issues ? rules.issues : []);
  const structuredIssues = issues.map(normalizeIssue);
  const healthSummary = calculateHealthScore(structuredIssues);
  const objectBreakdown = buildObjectBreakdown(structuredIssues, snapshot && snapshot.scope);
  const riskSummary = buildRiskSummary(structuredIssues);
  const executiveSummary = buildExecutiveSummary(
    structuredIssues,
    healthSummary,
    null,
    snapshot && snapshot.scope,
    {
      riskSummary,
      objectBreakdown,
      ai
    }
  );

  return {
    health_score: healthSummary.healthScore,
    score_label: healthSummary.scoreLabel,
    score_summary: healthSummary.scoreSummary,
    total_issues: healthSummary.totalIssues,
    critical_issues: healthSummary.criticalIssues,
    high_issues: healthSummary.highIssues,
    medium_issues: healthSummary.mediumIssues,
    low_issues: healthSummary.lowIssues,
    info_issues: healthSummary.infoIssues,
    issue_details: structuredIssues,
    object_breakdown: objectBreakdown,
    risk_summary: riskSummary,
    risk_sections: buildRiskSections(structuredIssues),
    executive_summary: executiveSummary,
    score,
    snapshot_summary: {
      pipelines: Array.isArray(snapshot && snapshot.pipelines) ? snapshot.pipelines.length : 0,
      workflows: Array.isArray(snapshot && snapshot.workflows) ? snapshot.workflows.length : 0,
      forms: Array.isArray(snapshot && snapshot.forms) ? snapshot.forms.length : 0
    }
  };
}

module.exports = {
  buildProductizedAuditOutput,
  buildObjectBreakdown,
  calculateHealthScore,
  normalizeIssue,
  normalizeIssues,
  buildRiskSummary,
  buildRiskSections,
  buildExecutiveSummary,
  scoreLabel,
  normalizeRiskLevel
};
