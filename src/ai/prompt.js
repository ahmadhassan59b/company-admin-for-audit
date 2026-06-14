const env = require('../config/env');
const {
  buildAiFactsPayload
} = require('../services/audit/snapshotOptimizer');

function buildAuditPrompt(snapshot, issues, promptMode = env.aiPromptMode, factsPayload = null, options = {}) {
  const facts =
    factsPayload ||
    buildAiFactsPayload(snapshot, issues, promptMode, env.aiMaxInputChars || 8000, {
      objectType: options.objectType || null,
      objectLabel: options.objectLabel || null
    });

  const objectLabel = options.objectLabel || options.objectType || null;

  return [
    'You are a senior HubSpot CRM audit consultant.',
    objectLabel
      ? `Focus on the ${String(objectLabel)} section of the audit.`
      : 'Focus on the full HubSpot portal audit.',
    'Use only the JSON facts below to write a specific audit.',
    'The snapshot includes only the sections listed in included_sections; omitted sections were intentionally excluded for optimization.',
    'Return only JSON with keys summary, quick_wins, strategic_recommendations, and risk_level.',
    'Make strategic_recommendations the executive next steps: concrete, action-oriented, and specific to the audit findings.',
    'Avoid generic advice unless the facts are sparse.',
    'Do not use markdown.',
    `FACTS_JSON:${JSON.stringify(facts)}`
  ].join('\n');
}

function buildNoIssueAiResult(snapshot, options = {}) {
  const capabilities = snapshot && snapshot.capabilities ? snapshot.capabilities : null;
  const unavailable = capabilities
    ? Object.entries(capabilities)
        .filter(([, value]) => value === 'unavailable')
        .map(([key]) => key)
    : [];
  const objectLabel = options.objectLabel || options.objectType || null;
  const subject = objectLabel ? `${objectLabel} section` : 'current HubSpot setup';

  return {
    summary: unavailable.length
      ? `No major issues found in the available ${subject}. Some sources were unavailable: ${unavailable.join(', ')}.`
      : `No major issues found in the ${subject}.`,
    quick_wins: [],
    strategic_recommendations: [],
    risk_level: 'low'
  };
}

module.exports = {
  buildAuditPrompt,
  buildNoIssueAiResult
};
