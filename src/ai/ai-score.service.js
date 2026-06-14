function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function baseFromRisk(riskLevel) {
  const level = String(riskLevel || '').toLowerCase();
  if (level === 'low') return 85;
  if (level === 'medium') return 65;
  if (level === 'high') return 45;
  return 65;
}

// AI score is a separate, AI-informed metric. We keep it distinct from the deterministic score.
// It is derived from the AI risk_level plus the deterministic score as a stabilizer.
function calculateAiScore(deterministicScore, aiResult) {
  const det = Number.isFinite(Number(deterministicScore)) ? Number(deterministicScore) : 0;
  const base = baseFromRisk(aiResult && aiResult.risk_level);
  const blended = det * 0.6 + base * 0.4;
  return clamp(Math.round(blended), 0, 100);
}

module.exports = {
  calculateAiScore
};

