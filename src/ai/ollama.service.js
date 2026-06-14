const axios = require('axios');
const env = require('../config/env');
const { AppError } = require('../utils/errors');
const { AIResultSchema } = require('./schema');

function isOllamaEnabled() {
  return Boolean(env.ollamaBaseUrl);
}

async function analyzeWithOllama(prompt, { model, temperature } = {}) {
  if (!isOllamaEnabled()) {
    throw new AppError('Ollama is not configured', 400, 'ollama_not_configured');
  }

  const chosenModel = model || env.ollamaModel;
  const temp = typeof temperature === 'number' ? temperature : 0.2;

  const url = new URL('/api/generate', env.ollamaBaseUrl).toString();

  try {
    const attempt = async (attemptNumber) => {
      const response = await axios.post(
        url,
        {
          model: chosenModel,
          prompt:
            attemptNumber === 1
              ? prompt
              : `${prompt}\n\nIMPORTANT: Your previous output was not valid JSON. Return ONLY a single JSON object with the required keys.`,
          stream: false,
          format: 'json',
          options: {
            temperature: attemptNumber === 1 ? temp : 0,
            num_predict: 380
          }
        },
        {
          timeout: 300000
        }
      );

      const raw = response.data && response.data.response ? response.data.response : '';
      const meta = response.data
        ? {
            total_duration: response.data.total_duration || null,
            eval_count: response.data.eval_count || null,
            done_reason: response.data.done_reason || null
          }
        : null;

      const parsed = safeParseJSON(raw, { meta });
      return AIResultSchema.parse(parsed);
    };

    try {
      return await attempt(1);
    } catch (error) {
      if (error instanceof AppError && error.code === 'ollama_invalid_json') {
        return await attempt(2);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const statusCode = error.response ? error.response.status : 502;
    const details = error.response && error.response.data ? error.response.data : null;

    const appError = new AppError(
      'Ollama request failed',
      statusCode >= 500 ? 502 : 400,
      'ollama_request_failed'
    );
    appError.details = {
      statusCode: error.response ? error.response.status : null,
      message: error.message || null,
      url,
      model: chosenModel,
      ollama: details
    };
    throw appError;
  }
}

function safeParseJSON(raw, { meta } = {}) {
  try {
    return JSON.parse(raw);
  } catch {
    const extracted = extractFirstJsonObject(String(raw || ''));
    if (!extracted) {
      const err = new AppError('Invalid JSON from Ollama', 502, 'ollama_invalid_json');
      err.details = {
        meta: meta || null,
        raw_preview: String(raw || '').slice(0, 2000)
      };
      throw err;
    }

    return JSON.parse(extracted);
  }
}

function extractFirstJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return s.slice(start, i + 1);
    }
  }

  return null;
}

module.exports = {
  isOllamaEnabled,
  analyzeWithOllama
};
