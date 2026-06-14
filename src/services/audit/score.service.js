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

function normalizeRiskLevel(value) {
  const severity = String(value || 'low').toLowerCase();
  if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low' || severity === 'info') {
    return severity;
  }
  return 'low';
}

function normalizeIssues(issues) {
  return Array.isArray(issues) ? issues.filter(Boolean) : [];
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
  const low = Number(counts.lowIssues || 0);

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

function severityPenalty(issue) {
  const level = normalizeRiskLevel(issue && (issue.riskLevel || issue.severity));
  const numericSeverity = Number(issue && issue.severityScore);
  if (Number.isFinite(numericSeverity)) {
    return Math.max(0, numericSeverity);
  }
  return RISK_POINTS[level] || 0;
}

function summarizeIssues(issues) {
  return normalizeIssues(issues).reduce(
    (acc, issue) => {
      const riskLevel = normalizeRiskLevel(issue && (issue.riskLevel || issue.severity));
      const penalty = severityPenalty(issue);

      acc.totalIssues += 1;
      acc[`${riskLevel}Issues`] += 1;
      acc.rawPenalty += penalty;
      acc.rawPenaltyByLevel[riskLevel] += penalty;
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

function buildCappedPenaltyByLevel(rawPenaltyByLevel) {
  return Object.entries(rawPenaltyByLevel).reduce(
    (acc, [level, penalty]) => {
      acc[level] = Math.min(Number(penalty) || 0, RISK_CAPS[level] || 0);
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

function calculateHealthScoreDetails(issues) {
  const summary = summarizeIssues(issues);
  const penaltyByLevel = buildCappedPenaltyByLevel(summary.rawPenaltyByLevel);
  const totalPenalty = Object.values(penaltyByLevel).reduce((sum, value) => sum + value, 0);
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

function calculateHealthScore(issues) {
  return calculateHealthScoreDetails(issues).healthScore;
}

module.exports = {
  RISK_POINTS,
  RISK_CAPS,
  normalizeRiskLevel,
  scoreLabel,
  calculateHealthScore,
  calculateHealthScoreDetails
};
