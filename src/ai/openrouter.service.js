const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { AIResultSchema } = require('./schema');

function isOpenRouterEnabled() {
  return Boolean(env.openrouterApiKey);
}

function buildJsonSchemaResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'audit_ai',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: {
            type: 'string',
            description: 'Concise audit summary.'
          },
          quick_wins: {
            type: 'array',
            description: 'Short-term fixes the user can do in days.',
            items: { type: 'string' }
          },
          strategic_recommendations: {
            type: 'array',
            description: 'Longer-term recommendations for the coming weeks or months.',
            items: { type: 'string' }
          },
          risk_level: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Overall AI-assessed risk level.'
          }
        },
        required: ['summary', 'quick_wins', 'strategic_recommendations', 'risk_level']
      }
    }
  };
}

async function analyzeWithOpenRouter(prompt, { model, temperature } = {}) {
  if (!isOpenRouterEnabled()) {
    throw new AppError('OpenRouter API key is not configured', 400, 'openrouter_not_configured');
  }

  const chosenModel = model || env.openrouterModel || 'openai/gpt-oss-120b:free';
  const temp = typeof temperature === 'number' ? temperature : 0.2;
  const attempts = [
    {
      responseFormat: buildJsonSchemaResponseFormat(),
      prompt
    },
    {
      responseFormat: { type: 'json_object' },
      prompt: `${prompt}\n\nReturn only valid JSON. Use lowercase risk_level and do not include markdown.`
    }
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const raw = await requestOpenRouterCompletion(chosenModel, temp, attempt.prompt, attempt.responseFormat);
      const parsed = safeParseJSON(raw);
      const normalized = normalizeAiResult(parsed);
      return AIResultSchema.parse(normalized);
    } catch (error) {
      lastError = error;

      if (!shouldRetryOpenRouter(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function requestOpenRouterCompletion(model, temperature, prompt, responseFormat) {
  const baseUrl = env.openrouterBaseUrl || 'https://openrouter.ai/api/v1';
  const url = new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.appBaseUrl || 'http://localhost',
      'X-Title': env.openrouterAppName || 'HubAudit'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Return only the requested JSON object.' },
        { role: 'user', content: prompt }
      ],
      temperature,
      response_format: responseFormat,
      stream: false
    })
  });

  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = safeParseJSON(text);
    } catch {
      body = { rawText: text };
    }
  }

  if (!response.ok) {
    const providerError = body && body.error ? body.error : null;
    const message =
      (providerError && providerError.message) ||
      body.message ||
      'OpenRouter request failed';
    const code =
      (providerError && providerError.code) ||
      (providerError && providerError.type) ||
      'openrouter_request_failed';
    const appError = new AppError(message, response.status >= 500 ? 502 : 400, code);
    appError.details = {
      status: response.status,
      body
    };
    throw appError;
  }

  const raw = body?.choices?.[0]?.message?.content || '';

  if (!raw) {
    const appError = new AppError('OpenRouter returned an empty response', 502, 'openrouter_empty_response');
    appError.details = { body };
    throw appError;
  }

  return raw;
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) {
      throw new AppError('Invalid JSON from OpenRouter', 502, 'openrouter_invalid_json');
    }
    return JSON.parse(match[0]);
  }
}

function shouldRetryOpenRouter(error) {
  if (!error) return false;

  const code = String(error.code || error.details?.code || '').toLowerCase();
  const status = Number(error.status || error.details?.status || 0);
  const message = String(error.message || '').toLowerCase();

  return (
    code === 'openrouter_request_failed' ||
    code === 'openrouter_invalid_json' ||
    code === 'openrouter_empty_response' ||
    status >= 500 ||
    message.includes('fetch failed') ||
    message.includes('invalid json')
  );
}

function normalizeAiResult(value) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    summary: normalizeString(
      source.summary ||
        source.overview ||
        source.analysis ||
        source.result ||
        source.message ||
        ''
    ),
    quick_wins: normalizeStringArray(
      source.quick_wins ||
        source.quickWins ||
        source.quick_wins_list ||
        source.quickWinsList ||
        []
    ),
    strategic_recommendations: normalizeStringArray(
      source.strategic_recommendations ||
        source.strategicRecommendations ||
        source.recommendations ||
        source.long_term_recommendations ||
        []
    ),
    risk_level: normalizeRiskLevel(
      source.risk_level || source.riskLevel || source.risk || source.risk_assessment || ''
    )
  };
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : String(value || '').trim();
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n|;\s*/g)
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  return [];
}

function normalizeRiskLevel(value) {
  const text = normalizeString(value).toLowerCase();

  if (text.includes('high')) return 'high';
  if (text.includes('medium') || text.includes('moderate')) return 'medium';
  if (text.includes('low')) return 'low';

  return 'medium';
}

module.exports = {
  isOpenRouterEnabled,
  analyzeWithOpenRouter
};
