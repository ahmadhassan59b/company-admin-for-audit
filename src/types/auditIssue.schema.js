/**
 * JS-friendly audit issue contract documentation.
 *
 * This file is intentionally runtime-safe JavaScript instead of TypeScript so the
 * codebase can keep its current JS-first structure while still documenting the
 * normalized issue shape used by the audit engine, report layer, exports, and UI.
 */

const RISK_LEVELS = ['critical', 'high', 'medium', 'low', 'info'];

const OBJECT_TYPES = [
  'contacts',
  'companies',
  'deals',
  'workflows',
  'forms',
  'emails',
  'properties',
  'pipelines',
  'owners',
  'lists',
  'associations'
];

const AUDIT_ISSUE_SCHEMA = {
  id: 'string',
  objectType: 'contacts | companies | deals | workflows | forms | emails | properties | pipelines | owners | lists | associations',
  category: 'string',
  title: 'string',
  description: 'string',
  impact: 'string',
  recommendation: 'string',
  riskLevel: 'critical | high | medium | low | info',
  severityScore: 'number',
  affectedCount: 'number | null',
  sampleRecords: 'array',
  source: 'rule_engine | ai'
};

module.exports = {
  RISK_LEVELS,
  OBJECT_TYPES,
  AUDIT_ISSUE_SCHEMA
};
