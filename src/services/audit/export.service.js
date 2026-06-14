const PDFDocument = require('pdfkit');
const { normalizeIssues } = require('./output.service');

function escapeCsv(value) {
  const text = String(value === null || typeof value === 'undefined' ? '' : value);
  if (/["\n,]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildCsvExport(report) {
  const issues = normalizeIssues(report && report.issue_details ? report.issue_details : []);
  const header = [
    'riskLevel',
    'objectType',
    'category',
    'title',
    'description',
    'impact',
    'recommendation',
    'affectedCount',
    'severityScore'
  ];

  const rows = issues.map((issue) => [
    issue.riskLevel || issue.severity || '',
    issue.objectType || '',
    issue.category || '',
    issue.title || '',
    issue.description || issue.detail || issue.message || '',
    issue.impact || '',
    issue.recommendation || '',
    issue.affectedCount === null || typeof issue.affectedCount === 'undefined' ? '' : issue.affectedCount,
    issue.severityScore === null || typeof issue.severityScore === 'undefined' ? '' : issue.severityScore
  ]);

  return [header, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n');
}

function safeText(value, fallback = '') {
  if (value === null || typeof value === 'undefined') return fallback;
  const text = String(value);
  return text.trim().length ? text : fallback;
}

function normalizeRiskLevel(value) {
  const risk = safeText(value, 'info').toLowerCase();
  return ['critical', 'high', 'medium', 'low', 'info'].includes(risk) ? risk : 'info';
}

function getList(report, camelKey, snakeKey, fallback = []) {
  const value = report && (report[camelKey] || report[snakeKey]);
  return Array.isArray(value) ? value.filter(Boolean) : fallback;
}

function getExecutiveSummary(report) {
  const summary = report && report.executive_summary && typeof report.executive_summary === 'object'
    ? report.executive_summary
    : {};
  return {
    headline: safeText(summary.headline, 'Your HubSpot portal needs attention'),
    summary: safeText(summary.summary, 'No executive summary available.'),
    topRisks: getList(summary, 'topRisks', 'top_risks', []),
    recommendedNextSteps: getList(summary, 'recommendedNextSteps', 'recommended_next_steps', []),
    scoreSummary: summary.score_summary && typeof summary.score_summary === 'object' ? summary.score_summary : null
  };
}

function getObjectBreakdown(report) {
  const items = Array.isArray(report && report.object_breakdown) ? report.object_breakdown : [];
  return items.length ? items : [];
}

function getRiskSections(report) {
  const sections = Array.isArray(report && report.risk_sections)
    ? report.risk_sections
    : Array.isArray(report && report.riskSections)
      ? report.riskSections
      : [];

  return sections.length ? sections : [];
}

function getIssues(report) {
  return normalizeIssues(report && report.issue_details ? report.issue_details : []);
}

function getReportMeta(report) {
  const audit = report && report.audit ? report.audit : {};
  return {
    portalId: safeText(report.hubspot_portal_id || audit.hubspot_portal_id || report.portalId || audit.portalId, 'n/a'),
    auditNumber: safeText(report.audit_number || audit.audit_number || report.id || audit.id || report.auditId || audit.auditId, 'n/a'),
    auditId: safeText(report.id || report.audit_id || report.auditId || audit.id || audit.auditId, 'n/a'),
    auditDate: safeText(report.created_at || audit.created_at || report.audit_date || audit.audit_date, 'n/a'),
    scopeLabel: safeText(
      report.scope_label || audit.scope_label || (Array.isArray(report.scope) ? report.scope.join(', ') : '') || 'Full Audit',
      'Full Audit'
    )
  };
}

function issueLine(issue, fallbackRisk = 'info') {
  const riskLevel = normalizeRiskLevel(issue.riskLevel || issue.severity || fallbackRisk);
  const objectType = safeText(issue.objectType || issue.object_type || issue.category || 'general', 'general');
  const title = safeText(issue.title || issue.message || issue.detail || 'Issue', 'Issue');
  const affected = safeText(
    issue.affectedCount ?? issue.affected_count ?? issue.count ?? '',
    ''
  );
  const impact = safeText(issue.impact || 'No impact details available.', 'No impact details available.');
  const recommendation = safeText(issue.recommendation || 'Review this issue.', 'Review this issue.');
  return {
    riskLevel,
    objectType,
    title,
    affected,
    impact,
    recommendation
  };
}

function renderHeader(doc, title, subtitle = '') {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f172a').text(title, {
    width,
    align: 'left'
  });
  if (subtitle) {
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(11).fillColor('#64748b').text(subtitle, { width });
  }
  doc.moveDown(0.35);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.6);
}

function renderKeyValueList(doc, entries, columns = 2) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidth = columns > 1 ? (width - 18) / columns : width;
  entries.forEach((entry, index) => {
    const x = doc.page.margins.left + (columns > 1 ? (index % columns) * (columnWidth + 18) : 0);
    if (columns > 1 && index % columns === 0 && index > 0) {
      doc.moveDown(1.1);
    }
    if (columns > 1) {
      doc.x = x;
      doc.y = doc.y;
    }
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(entry.label, {
      width: columnWidth
    });
    doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(entry.value, {
      width: columnWidth
    });
  });
  doc.moveDown(0.8);
}

function renderBulletList(doc, items, fallback = 'None') {
  const list = Array.isArray(items) && items.length ? items : [fallback];
  list.forEach((item) => {
    doc.font('Helvetica').fontSize(10.5).fillColor('#0f172a').text(`• ${safeText(item, fallback)}`, {
      indent: 12,
      continued: false
    });
    doc.moveDown(0.12);
  });
}

function renderParagraph(doc, text, options = {}) {
  doc.font('Helvetica').fontSize(options.size || 10.5).fillColor(options.color || '#0f172a').text(
    safeText(text, options.fallback || 'No information available.'),
    {
      width: options.width || doc.page.width - doc.page.margins.left - doc.page.margins.right,
      lineGap: options.lineGap || 3
    }
  );
}

function formatReportDate(value) {
  const text = safeText(value, '');
  if (!text) return 'n/a';
  return text.replace('T', ' ').replace('Z', '').replace(/\.\d+$/, '');
}

function normalizeEntityLabel(value) {
  const key = safeText(value, '').toLowerCase();
  const map = {
    contacts: 'CONTACT',
    contact: 'CONTACT',
    companies: 'COMPANY',
    company: 'COMPANY',
    deals: 'DEAL',
    deal: 'DEAL',
    workflows: 'WORKFLOW',
    workflow: 'WORKFLOW',
    forms: 'FORM',
    form: 'FORM',
    emails: 'EMAIL',
    email: 'EMAIL',
    properties: 'PROPERTY',
    property: 'PROPERTY',
    pipelines: 'PIPELINE',
    pipeline: 'PIPELINE',
    owners: 'OWNER',
    owner: 'OWNER',
    lists: 'LIST',
    list: 'LIST',
    associations: 'ASSOCIATION',
    association: 'ASSOCIATION'
  };
  return map[key] || key.toUpperCase() || 'GENERAL';
}

function normalizePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  if (numeric <= 1 && numeric > 0) return `${Math.round(numeric * 100)}`;
  return `${Math.round(numeric)}`;
}

function normalizeNumberCell(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : '--';
}

function getRiskBadgeStyle(riskLevel) {
  const normalized = normalizeRiskLevel(riskLevel);
  switch (normalized) {
    case 'critical':
      return { fill: '#fee2e2', text: '#b91c1c', border: '#fca5a5', label: 'Critical Risk' };
    case 'high':
      return { fill: '#fff7ed', text: '#c2410c', border: '#fdba74', label: 'High Risk' };
    case 'medium':
      return { fill: '#fffbeb', text: '#b45309', border: '#fcd34d', label: 'Medium Risk' };
    case 'low':
      return { fill: '#ecfdf5', text: '#047857', border: '#6ee7b7', label: 'Low Risk' };
    default:
      return { fill: '#f1f5f9', text: '#475569', border: '#cbd5e1', label: 'Info' };
  }
}

function buildPdfTableRows(report) {
  const issues = getIssues(report);
  const reportDate = formatReportDate(report.created_at || report.audit?.created_at || report.audit_date || report.audit?.audit_date);
  return issues
    .slice()
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const riskDiff = (rank[normalizeRiskLevel(a.riskLevel || a.severity)] ?? 4) - (rank[normalizeRiskLevel(b.riskLevel || b.severity)] ?? 4);
      if (riskDiff !== 0) return riskDiff;
      const countDiff = Number(b.affectedCount || b.count || 0) - Number(a.affectedCount || a.count || 0);
      if (countDiff !== 0) return countDiff;
      return String(a.title || '').localeCompare(String(b.title || ''));
    })
    .map((issue) => {
      const riskLevel = normalizeRiskLevel(issue.riskLevel || issue.severity);
      const title = safeText(issue.parameter || issue.title || issue.message || issue.name || 'Issue', 'Issue');
      const entity = normalizeEntityLabel(issue.entity || issue.objectType || issue.object_type || issue.category || 'general');
      const count = normalizeNumberCell(issue.count ?? issue.affectedCount ?? issue.affected_count ?? issue.total ?? issue.totalCount);
      const percentage = normalizePercent(issue.percentage ?? issue.percent ?? issue.ratio ?? issue.share);
      const score = normalizeNumberCell(issue.score ?? issue.severityScore ?? issue.severity_score);
      const date = formatReportDate(issue.date || issue.created_at || issue.updatedAt || issue.updated_at || reportDate);

      return {
        parameter: title,
        entity,
        count,
        percentage,
        score,
        date,
        riskLevel,
        riskLabel: getRiskBadgeStyle(riskLevel).label,
        impact: safeText(issue.impact || issue.description || issue.detail || issue.message, 'No impact details available.'),
        recommendation: safeText(issue.recommendation || 'Review this issue.', 'Review this issue.')
      };
    });
}

function drawChip(doc, x, y, text, colors, height = 18) {
  const paddingX = 8;
  const textWidth = doc.widthOfString(text);
  const chipWidth = Math.max(38, textWidth + paddingX * 2);
  doc.save();
  doc.roundedRect(x, y, chipWidth, height, 8).fillAndStroke(colors.fill, colors.border);
  doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(8.8).text(text, x, y + 4, {
    width: chipWidth,
    align: 'center'
  });
  doc.restore();
  return chipWidth;
}

function drawTableHeader(doc, columns, y) {
  let x = doc.page.margins.left;
  const headerHeight = 28;
  doc.save();
  doc.rect(x, y, columns.reduce((sum, column) => sum + column.width, 0), headerHeight).fill('#a7f3d0');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10.5);
  columns.forEach((column) => {
    doc.text(column.label, x + 10, y + 8, {
      width: column.width - 20,
      align: column.align || 'left'
    });
    x += column.width;
  });
  doc.restore();
}

function drawTableRow(doc, columns, row, y, rowIndex) {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const rowHeight = Math.max(
    30,
    ...columns.map((column) => {
      const value = String(row[column.key] || '');
      return doc.heightOfString(value, { width: column.width - 20, align: column.align || 'left' }) + 18;
    })
  );

  doc.save();
  doc.rect(doc.page.margins.left, y, totalWidth, rowHeight).fill(rowIndex % 2 === 0 ? '#f8fafc' : '#ffffff');
  doc.restore();

  let x = doc.page.margins.left;
  columns.forEach((column) => {
    const value = String(row[column.key] || '');
    const cellPadding = 10;
    if (column.key === 'riskLabel') {
      const badge = getRiskBadgeStyle(row.riskLevel);
      const badgeY = y + Math.max(5, (rowHeight - 18) / 2);
      drawChip(doc, x + 8, badgeY, value || badge.label, badge, 18);
    } else {
      doc.fillColor('#0f172a').font('Helvetica').fontSize(9.5).text(value, x + cellPadding, y + 8, {
        width: column.width - (cellPadding * 2),
        align: column.align || 'left',
        lineBreak: true
      });
    }
    x += column.width;
  });

  return rowHeight;
}

function renderTablePageHeading(doc, meta, score, scoreLabel) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const headerHeight = 62;
  const y = doc.page.margins.top - 2;
  doc.save();
  doc.rect(doc.page.margins.left, y, width, headerHeight).fill('#0f172a');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('Audit Results Report', doc.page.margins.left + 14, y + 14);
  doc.font('Helvetica').fontSize(9.5).text(
    `Portal ID: ${meta.portalId}   |   Audit ID: ${meta.auditId}   |   Audit Date: ${meta.auditDate}`,
    doc.page.margins.left + 14,
    y + 34,
    { width: width - 28, color: '#cbd5e1' }
  );
  doc.restore();

  const chipY = y + 16;
  let chipX = doc.page.width - doc.page.margins.right - 12;
  const chips = [
    { text: String(score === null || typeof score === 'undefined' ? '--' : score), colors: { fill: '#f0fdf4', text: '#166534', border: '#86efac' } },
    { text: scoreLabel || 'Unknown', colors: { fill: '#fff7ed', text: '#c2410c', border: '#fdba74' } }
  ];
  chips.reverse().forEach((chip, index) => {
    const widthNeeded = Math.max(48, doc.widthOfString(chip.text) + 20);
    chipX -= widthNeeded;
    drawChip(doc, chipX, chipY, chip.text, chip.colors, 20);
    chipX -= 10;
  });
}

function renderIssueBlock(doc, issue, fallbackRisk = 'info') {
  const normalized = issueLine(issue, fallbackRisk);
  const riskColorMap = {
    critical: '#dc2626',
    high: '#ea580c',
    medium: '#d97706',
    low: '#16a34a',
    info: '#475569'
  };
  const label = normalized.riskLevel.toUpperCase();

  doc.font('Helvetica-Bold').fontSize(11).fillColor(riskColorMap[normalized.riskLevel] || '#475569').text(
    `${label} | ${normalized.objectType}`,
    { continued: false }
  );
  doc.moveDown(0.12);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text(normalized.title);
  doc.font('Helvetica').fontSize(10.5).fillColor('#475569').text(
    normalized.affected ? `Affected count: ${normalized.affected}` : 'Affected count: n/a'
  );
  renderParagraph(doc, `Impact: ${normalized.impact}`, { size: 10.2, color: '#334155' });
  renderParagraph(doc, `Recommendation: ${normalized.recommendation}`, { size: 10.2, color: '#334155' });
}

function renderPdfReport(doc, report) {
  const meta = getReportMeta(report);
  const score = report.health_score ?? report.score ?? '--';
  const scoreLabel = safeText(report.score_label, 'Unknown');
  const scoreSummary = report.score_summary && typeof report.score_summary === 'object'
    ? report.score_summary
    : null;
  const summary = getExecutiveSummary(report);
  const objectBreakdown = getObjectBreakdown(report);
  const riskSummary = report && report.risk_summary && typeof report.risk_summary === 'object' ? report.risk_summary : {};
  const riskSections = getRiskSections(report);
  const sectionsByKey = new Map(
    riskSections
      .filter((section) => section && (section.key || section.label || section.riskLevel))
      .map((section) => [normalizeRiskLevel(section.key || section.label || section.riskLevel), section])
  );
  const rows = buildPdfTableRows(report);
  const columns = [
    { key: 'parameter', label: 'Parameter', width: 240 },
    { key: 'entity', label: 'Entity', width: 100 },
    { key: 'count', label: 'Count', width: 70, align: 'right' },
    { key: 'percentage', label: 'Percentage', width: 90, align: 'right' },
    { key: 'score', label: 'Score', width: 65, align: 'right' },
    { key: 'date', label: 'Date', width: 120 },
    { key: 'riskLabel', label: 'Risk Level', width: 130 }
  ];
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  let currentY = doc.page.margins.top + 70;

  doc.page.layout = 'landscape';
  doc.page.margins = { top: 28, bottom: 34, left: 34, right: 34 };
  renderTablePageHeading(doc, meta, score, scoreLabel);

  const summaryY = 80;
  doc.roundedRect(doc.page.margins.left, summaryY, tableWidth, 42).fill('#f8fafc');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10.5).text(summary.headline, doc.page.margins.left + 12, summaryY + 10, {
    width: tableWidth - 24
  });
  doc.font('Helvetica').fontSize(9.2).fillColor('#475569').text(
    scoreSummary && scoreSummary.text ? scoreSummary.text : summary.summary,
    doc.page.margins.left + 12,
    summaryY + 24,
    { width: tableWidth - 24 }
  );

  currentY = summaryY + 56;
  drawTableHeader(doc, columns, currentY);
  currentY += 28;

  if (!rows.length) {
    doc.font('Helvetica').fontSize(10.5).fillColor('#475569').text('No issues found.', doc.page.margins.left + 10, currentY + 8);
    currentY += 24;
  } else {
    rows.forEach((row, index) => {
      const estimateHeight = Math.max(
        30,
        ...columns.map((column) => {
          const value = String(row[column.key] || '');
          return doc.heightOfString(value, { width: column.width - 20 }) + 18;
        })
      );

      if (currentY + estimateHeight > pageBottom() - 8) {
        doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 34, left: 34, right: 34 } });
        renderTablePageHeading(doc, meta, score, scoreLabel);
        currentY = doc.page.margins.top + 64;
        drawTableHeader(doc, columns, currentY);
        currentY += 28;
      }

      const rowHeight = drawTableRow(doc, columns, row, currentY, index);
      currentY += rowHeight;
    });
  }

  doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 34, left: 34, right: 34 } });
  renderHeader(doc, 'Executive Summary', 'High-level audit overview');
  doc.roundedRect(doc.page.margins.left, doc.y, tableWidth, 46).fill('#f8fafc');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text(summary.headline, doc.page.margins.left + 12, doc.y + 10, {
    width: tableWidth - 24
  });
  doc.font('Helvetica').fontSize(10.5).fillColor('#334155').text(summary.summary, doc.page.margins.left + 12, doc.y + 26, {
    width: tableWidth - 24
  });
  doc.moveDown(3.2);

  const summaryCols = [
    { label: 'Critical', value: String(riskSummary.critical || 0) },
    { label: 'High', value: String(riskSummary.high || 0) },
    { label: 'Medium', value: String(riskSummary.medium || 0) },
    { label: 'Low', value: String(riskSummary.low || 0) },
    { label: 'Info', value: String(riskSummary.info || 0) }
  ];
  const statWidth = (tableWidth - 24) / summaryCols.length;
  summaryCols.forEach((item, index) => {
    const x = doc.page.margins.left + 12 + index * statWidth;
    doc.roundedRect(x, doc.y, statWidth - 8, 46).fill('#ffffff').stroke('#e2e8f0');
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(9).text(item.label, x + 10, doc.y + 8, { width: statWidth - 28, align: 'left' });
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text(item.value, x + 10, doc.y + 20, { width: statWidth - 28, align: 'left' });
  });

  doc.moveDown(4.2);
  renderHeader(doc, 'Object Breakdown', 'Object-level health cards from the report');
  if (!objectBreakdown.length) {
    renderParagraph(doc, 'No object breakdown available.', { fallback: 'No object breakdown available.' });
  } else {
    objectBreakdown.forEach((item) => {
      const label = safeText(item.label || item.objectType, 'Object');
      const itemScore = item.score === null || typeof item.score === 'undefined' ? 'n/a' : `${item.score}/100`;
      const itemScoreLabel = safeText(item.scoreLabel || item.score_label || 'Unknown', 'Unknown');
      const highestRisk = normalizeRiskLevel(item.highestRisk || item.highestRiskLevel || 'info');
      const totalIssues = item.totalIssues ?? item.issueCount ?? 0;
      const summaryText = safeText(item.summary || item.quickSummary, 'No summary available.');

      doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(label);
      doc.font('Helvetica').fontSize(10.5).fillColor('#334155').text(
        `Score: ${itemScore} | Label: ${itemScoreLabel} | Issues: ${totalIssues} | Highest Risk: ${highestRisk.toUpperCase()}`
      );
      renderParagraph(doc, summaryText, { size: 10.5, color: '#475569', fallback: 'No summary available.' });
      doc.moveDown(0.35);
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveDown(0.5);
    });
  }

  doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 34, left: 34, right: 34 } });
  renderHeader(doc, 'Risk Summary', 'Prioritized issue bands from the audit');
  renderKeyValueList(doc, [
    { label: 'Critical', value: String(riskSummary.critical || 0) },
    { label: 'High', value: String(riskSummary.high || 0) },
    { label: 'Medium', value: String(riskSummary.medium || 0) },
    { label: 'Low', value: String(riskSummary.low || 0) },
    { label: 'Info', value: String(riskSummary.info || 0) }
  ], 2);

  ['critical', 'high', 'medium', 'low', 'info'].forEach((riskKey) => {
    const section = sectionsByKey.get(riskKey);
    const sectionIssues = Array.isArray(section && section.issues) && section.issues.length
      ? section.issues
      : rows.filter((issue) => normalizeRiskLevel(issue.riskLevel) === riskKey);
    const bandLabel =
      riskKey === 'critical'
        ? 'Critical Issues'
        : riskKey === 'high'
          ? 'High Priority Issues'
          : riskKey === 'medium'
            ? 'Medium Priority Issues'
            : riskKey === 'low'
              ? 'Low Priority Issues'
              : 'Informational Findings';

    doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 34, left: 34, right: 34 } });
    renderHeader(doc, bandLabel, `Total findings: ${sectionIssues.length}`);
    if (!sectionIssues.length) {
      renderParagraph(doc, 'No issues found in this category.', {
        fallback: 'No issues found in this category.'
      });
      return;
    }

    sectionIssues.forEach((issue, index) => {
      const normalized = issue.parameter ? issue : {
        parameter: issue.title || issue.name || 'Issue',
        entity: issue.entity || issue.objectType || 'GENERAL',
        count: issue.count ?? issue.affectedCount ?? '',
        percentage: issue.percentage ?? '',
        score: issue.score ?? issue.severityScore ?? '',
        date: issue.date || '',
        riskLabel: issue.riskLabel || getRiskBadgeStyle(issue.riskLevel).label,
        riskLevel: issue.riskLevel || 'info'
      };
      if (index > 0) {
        doc.moveDown(0.5);
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#e2e8f0').stroke();
        doc.moveDown(0.4);
      }
      renderIssueBlock(doc, normalized, riskKey);
    });
  });

  doc.addPage({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 34, left: 34, right: 34 } });
  renderHeader(doc, 'Recommendations', 'Actionable follow-up items');
  renderBulletList(doc, summary.recommendedNextSteps, 'No recommendations available.');
}

function exportAuditPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 48,
      bufferPages: true
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      renderPdfReport(doc, report || {});
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function buildPdfBuffer(report) {
  return exportAuditPdf(report);
}

module.exports = {
  buildCsvExport,
  buildPdfBuffer,
  exportAuditPdf
};
