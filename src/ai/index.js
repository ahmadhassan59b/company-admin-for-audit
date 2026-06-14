const { buildAuditPrompt, buildNoIssueAiResult } = require('./prompt');
const { analyzeWithOpenAI, isAiEnabled } = require('./openai.service');
const { analyzeWithOllama, isOllamaEnabled } = require('./ollama.service');
const { analyzeWithOpenRouter, isOpenRouterEnabled } = require('./openrouter.service');
const env = require('../config/env');

function getErrorCode(error) {
  return (
    error?.code ||
    error?.body?.error?.code ||
    error?.body?.error?.type ||
    error?.details?.code ||
    null
  );
}

function getErrorMessage(error) {
  return error?.message || error?.body?.error?.message || '';
}

function isRetryableAiError(error) {
  const code = String(getErrorCode(error) || '').toLowerCase();
  const message = String(getErrorMessage(error) || '').toLowerCase();
  const status = Number(
    error?.status ||
      error?.statusCode ||
      error?.details?.status ||
      error?.details?.statusCode ||
      0
  );

  return (
    status === 429 ||
    status >= 500 ||
    code.includes('quota') ||
    code.includes('rate') ||
    code.includes('limit') ||
    code.includes('unavailable') ||
    code.includes('timeout') ||
    message.includes('insufficient_quota') ||
    message.includes('exceeded your current quota') ||
    message.includes('rate limit') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('model not found')
  );
}

async function analyzeAudit(snapshot, issues, options = {}) {
  const safeIssues = Array.isArray(issues) ? issues.filter(Boolean) : [];

  if (safeIssues.length === 0) {
    return buildNoIssueAiResult(snapshot);
  }

  const prompt = buildAuditPrompt(
    snapshot,
    safeIssues,
    options.aiPromptMode,
    options.aiFactsPayload || null,
    {
      objectType: options.aiObjectType || null,
      objectLabel: options.aiObjectLabel || null
    }
  );

  if (env.aiProvider === 'openrouter') {
    if (!isOpenRouterEnabled()) {
      throw new Error('AI_PROVIDER=openrouter but OPENROUTER_API_KEY is not set.');
    }
    return analyzeWithOpenRouter(prompt, options);
  }

  if (env.aiProvider === 'ollama') {
    if (!isOllamaEnabled()) {
      throw new Error('AI_PROVIDER=ollama but OLLAMA_BASE_URL is not set.');
    }
    return analyzeWithOllama(prompt, options);
  }

  if (env.aiProvider === 'openai') {
    if (!isAiEnabled()) {
      throw new Error('AI_PROVIDER=openai but OPENAI_API_KEY is not set.');
    }
    return analyzeWithOpenAI(prompt, options);
  }

  // Prefer OpenRouter for the free GPT-OSS path, then OpenAI, then Ollama.
  if (isOpenRouterEnabled()) {
    try {
      return await analyzeWithOpenRouter(prompt, options);
    } catch (error) {
      if (isRetryableAiError(error)) {
        if (isAiEnabled()) {
          try {
            return await analyzeWithOpenAI(prompt, options);
          } catch (openAiError) {
            if (isRetryableAiError(openAiError) && isOllamaEnabled()) {
              return analyzeWithOllama(prompt, options);
            }
            throw openAiError;
          }
        }

        if (isOllamaEnabled()) {
          return analyzeWithOllama(prompt, options);
        }
      }

      throw error;
    }
  }

  // Legacy OpenAI path retained for compatibility when OpenRouter is not configured.
  if (isAiEnabled()) {
    try {
      return await analyzeWithOpenAI(prompt, options);
    } catch (error) {
      if (isRetryableAiError(error) && isOllamaEnabled()) {
        return analyzeWithOllama(prompt, options);
      }
      throw error;
    }
  }

  if (isOllamaEnabled()) {
    return analyzeWithOllama(prompt, options);
  }

  // Neither provider configured.
  throw new Error('No AI provider configured. Set OPENROUTER_API_KEY, OPENAI_API_KEY, or OLLAMA_BASE_URL.');
}

module.exports = {
  analyzeAudit,
  isAiEnabled,
  isOllamaEnabled,
  isOpenRouterEnabled,
  buildNoIssueAiResult
};
