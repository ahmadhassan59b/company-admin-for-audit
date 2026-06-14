const db = require('../../config/db');
const env = require('../../config/env');

function estimateTokens(chars) {
  const value = Number(chars || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(value / 4));
}

function calculateAiCostEstimate({
  inputChars = 0,
  outputChars = 0,
  cacheHit = false
} = {}) {
  const inputTokens = estimateTokens(inputChars);
  const outputTokens = estimateTokens(outputChars);
  const inputRate = Number.isFinite(Number(env.aiCostPer1kInput))
    ? Number(env.aiCostPer1kInput)
    : 0;
  const outputRate = Number.isFinite(Number(env.aiCostPer1kOutput))
    ? Number(env.aiCostPer1kOutput)
    : 0;

  const aiCost = cacheHit
    ? 0
    : (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    ai_cost: roundMoney(aiCost),
    total_cost: roundMoney(aiCost)
  };
}

async function recordAuditCost(auditId, costRecord) {
  if (!auditId || !costRecord) return null;

  const {
    promptMode = null,
    model = null,
    cacheHit = false,
    inputChars = 0,
    outputChars = 0,
    aiCost = 0,
    totalCost = 0
  } = costRecord;

  await db.query(
    `
      INSERT INTO audit_costs (
        audit_id,
        prompt_mode,
        model,
        cache_hit,
        input_chars,
        output_chars,
        ai_cost,
        total_cost,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (audit_id)
      DO UPDATE SET
        prompt_mode = EXCLUDED.prompt_mode,
        model = EXCLUDED.model,
        cache_hit = EXCLUDED.cache_hit,
        input_chars = EXCLUDED.input_chars,
        output_chars = EXCLUDED.output_chars,
        ai_cost = EXCLUDED.ai_cost,
        total_cost = EXCLUDED.total_cost,
        updated_at = NOW()
    `,
    [
      Number(auditId),
      promptMode,
      model,
      Boolean(cacheHit),
      Number(inputChars || 0),
      Number(outputChars || 0),
      roundMoney(aiCost),
      roundMoney(totalCost)
    ]
  );

  return true;
}

function roundMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000000) / 1000000;
}

module.exports = {
  estimateTokens,
  calculateAiCostEstimate,
  recordAuditCost
};
