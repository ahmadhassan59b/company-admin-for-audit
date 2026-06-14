const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { AIResultSchema } = require('./schema');

function isAiEnabled() {
  return Boolean(env.openaiApiKey);
}

async function getClient() {
  // `openai` is ESM; load it lazily from CommonJS.
  const mod = await import('openai');
  const OpenAI = mod.default || mod;
  return new OpenAI({ apiKey: env.openaiApiKey });
}

async function getZodHelpers() {
  // Optional helper. If not present (older SDK), we fall back to JSON mode.
  try {
    const mod = await import('openai/helpers/zod');
    return mod;
  } catch {
    return null;
  }
}

async function analyzeWithOpenAI(prompt, { model, temperature } = {}) {
  if (!isAiEnabled()) {
    throw new AppError('OpenAI API key is not configured', 400, 'openai_not_configured');
  }

  const client = await getClient();
  const chosenModel = model || env.openaiModel;
  const temp = typeof temperature === 'number' ? temperature : 0.3;

  const zodHelpers = await getZodHelpers();

  try {
    // Preferred path: Structured Outputs via Responses API + Zod schema.
    if (client.responses && typeof client.responses.parse === 'function' && zodHelpers?.zodTextFormat) {
      const response = await client.responses.parse({
        model: chosenModel,
        input: [
          { role: 'system', content: 'Return only the requested JSON object.' },
          { role: 'user', content: prompt }
        ],
        temperature: temp,
        text: {
          format: zodHelpers.zodTextFormat(AIResultSchema, 'audit_ai')
        }
      });

      if (response.output_parsed) {
        return response.output_parsed;
      }
    }

    // Fallback: Chat Completions JSON mode + manual parse + validation.
    const response = await client.chat.completions.create({
      model: chosenModel,
      temperature: temp,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You must return only valid JSON.' },
        { role: 'user', content: prompt + '\n\nReturn ONLY a JSON object.' }
      ]
    });

    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = safeParseJSON(raw);
    return AIResultSchema.parse(parsed);
  } catch (error) {
    // Normalize OpenAI SDK errors into an AppError with a stable `code` for callers.
    const status = error && typeof error.status === 'number' ? error.status : null;
    const providerCode = error && error.code ? String(error.code) : null;
    const message = error && error.message ? String(error.message) : 'OpenAI request failed';

    const appError = new AppError(
      message,
      status && status >= 500 ? 502 : 400,
      providerCode || 'openai_request_failed'
    );

    appError.details = {
      status: status || null,
      code: providerCode || null
    };

    throw appError;
  }
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) {
      throw new AppError('Invalid JSON from OpenAI', 502, 'openai_invalid_json');
    }
    return JSON.parse(match[0]);
  }
}

module.exports = {
  isAiEnabled,
  analyzeWithOpenAI
};
