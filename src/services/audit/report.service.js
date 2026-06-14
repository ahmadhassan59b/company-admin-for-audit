const { buildProductizedAuditOutput } = require('./output.service');

function generateAuditReport(snapshot, rules, score, wasteEstimate, ai = null) {
  const productized = buildProductizedAuditOutput(snapshot, rules, score, ai);

  return {
    score,
    health_score: productized.health_score,
    score_label: productized.score_label,
    score_summary: productized.score_summary,
    total_issues: productized.total_issues,
    critical_issues: productized.critical_issues,
    high_issues: productized.high_issues,
    medium_issues: productized.medium_issues,
    low_issues: productized.low_issues,
    info_issues: productized.info_issues,
    issues: rules.issues.map((issue) => issue.message),
    issue_details: productized.issue_details,
    object_breakdown: productized.object_breakdown,
    risk_summary: productized.risk_summary,
    risk_sections: productized.risk_sections,
    executive_summary: productized.executive_summary,
    waste_estimate: wasteEstimate,
    summary: {
      pipeline_count: snapshot.pipelines.length,
      workflow_count: snapshot.workflows.length,
      form_count: snapshot.forms.length,
      active_users: snapshot.usage.active_users,
      total_users: snapshot.usage.total_users,
      usage_status: snapshot.usage.status,
      issue_count: rules.issue_count,
      health_score: productized.health_score,
      score_label: productized.score_label,
      score_summary: productized.score_summary
    }
  };
}

module.exports = {
  generateAuditReport
};
