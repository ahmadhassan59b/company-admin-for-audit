const dotenv = require('dotenv');

dotenv.config();

const required = [
  'PORT',
  'APP_BASE_URL',
  'HUBSPOT_CLIENT_ID',
  'HUBSPOT_CLIENT_SECRET',
  'HUBSPOT_REDIRECT_URI',
  'DATABASE_URL'
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

function normalizeScopeList(value, fallback = '') {
  const raw = String(value || fallback || '').trim();
  if (!raw) {
    return '';
  }

  return Array.from(
    new Set(
      raw
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    )
  ).join(' ');
}

const hubspotRequiredScopes = normalizeScopeList(
  process.env.HUBSPOT_REQUIRED_SCOPES || process.env.HUBSPOT_SCOPES,
  'crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read crm.schemas.contacts.read crm.schemas.companies.read crm.schemas.deals.read forms oauth'
);

const hubspotOptionalScopes = normalizeScopeList(
  process.env.HUBSPOT_OPTIONAL_SCOPES,
  'automation'
);

const env = {
  port: Number(process.env.PORT),
  appBaseUrl: process.env.APP_BASE_URL,
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL,
  hubspotClientId: process.env.HUBSPOT_CLIENT_ID,
  hubspotClientSecret: process.env.HUBSPOT_CLIENT_SECRET,
  hubspotRedirectUri: process.env.HUBSPOT_REDIRECT_URI,
  hubspotRequiredScopes,
  hubspotOptionalScopes,
  hubspotScopes: hubspotRequiredScopes,
  databaseUrl: process.env.DATABASE_URL,
  internalAccountKey: process.env.INTERNAL_ACCOUNT_KEY || 'default-team',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || process.env.HUBSPOT_CLIENT_SECRET,
  authJwtSecret:
    process.env.AUTH_JWT_SECRET ||
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.HUBSPOT_CLIENT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: Number.isFinite(Number(process.env.SMTP_PORT)) ? Number(process.env.SMTP_PORT) : 465,
  smtpSecure:
    process.env.SMTP_SECURE !== undefined
      ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
      : (Number.isFinite(Number(process.env.SMTP_PORT)) ? Number(process.env.SMTP_PORT) : 465) === 465,
  smtpUser: process.env.SMTP_USER || null,
  smtpPass: process.env.SMTP_PASS || null,
  emailFrom: String(process.env.EMAIL_FROM || process.env.SMTP_FROM || '').trim() || null,
  emailDevFallback: String(process.env.EMAIL_DEV_FALLBACK || '').toLowerCase() === 'true',
  emailVerificationTokenTtlMinutes: Number.isFinite(Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES))
    ? Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES)
    : 60,

  // Phase 3 (AI): optional. If not set, AI analysis is skipped.
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || null,
  openrouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free',
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openrouterAppName: process.env.OPENROUTER_APP_NAME || 'HubAudit',
  // AI prompt mode: compact | full
  aiPromptMode: process.env.AI_PROMPT_MODE || 'compact',
  hubspotAuditRecordLimit: Number.isFinite(Number(process.env.HUBSPOT_AUDIT_RECORD_LIMIT))
    ? Number(process.env.HUBSPOT_AUDIT_RECORD_LIMIT)
    : 300,
  aiMaxInputChars: Number.isFinite(Number(process.env.AI_MAX_INPUT_CHARS))
    ? Number(process.env.AI_MAX_INPUT_CHARS)
    : 8000,
  aiCacheTtlSeconds: Number.isFinite(Number(process.env.AI_CACHE_TTL_SECONDS))
    ? Number(process.env.AI_CACHE_TTL_SECONDS)
    : 3600,
  aiBackgroundQueueConcurrency: Number.isFinite(Number(process.env.AI_BACKGROUND_QUEUE_CONCURRENCY))
    ? Number(process.env.AI_BACKGROUND_QUEUE_CONCURRENCY)
    : 2,
  aiCostPer1kInput: Number.isFinite(Number(process.env.AI_COST_PER_1K_INPUT))
    ? Number(process.env.AI_COST_PER_1K_INPUT)
    : 0,
  aiCostPer1kOutput: Number.isFinite(Number(process.env.AI_COST_PER_1K_OUTPUT))
    ? Number(process.env.AI_COST_PER_1K_OUTPUT)
    : 0,
  monitoringWindowMs: Number.isFinite(Number(process.env.MONITORING_WINDOW_MS))
    ? Number(process.env.MONITORING_WINDOW_MS)
    : 5 * 60 * 1000,
  monitoringSlowRequestMs: Number.isFinite(Number(process.env.MONITORING_SLOW_REQUEST_MS))
    ? Number(process.env.MONITORING_SLOW_REQUEST_MS)
    : 2000,
  monitoringErrorRateAlertThreshold: Number.isFinite(Number(process.env.MONITORING_ERROR_RATE_ALERT_THRESHOLD))
    ? Number(process.env.MONITORING_ERROR_RATE_ALERT_THRESHOLD)
    : 0.1,
  monitoringMinRequestsForAlert: Number.isFinite(Number(process.env.MONITORING_MIN_REQUESTS_FOR_ALERT))
    ? Number(process.env.MONITORING_MIN_REQUESTS_FOR_ALERT)
    : 25,
  monitoringAlertCooldownMs: Number.isFinite(Number(process.env.MONITORING_ALERT_COOLDOWN_MS))
    ? Number(process.env.MONITORING_ALERT_COOLDOWN_MS)
    : 5 * 60 * 1000,
  securityIssuerName: process.env.SECURITY_ISSUER_NAME || 'HubAudit',
  // Optional local fallback (Ollama). Used when OpenAI is not configured or fails.
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || null,
  ollamaModel: process.env.OLLAMA_MODEL || 'gemma2:2b',
  // Account label fallback format: dash | paren
  accountLabelFormat: process.env.ACCOUNT_LABEL_FORMAT || 'dash',
  // AI provider selection: auto | openrouter | openai | ollama
  aiProvider: process.env.AI_PROVIDER || 'auto'
};

module.exports = env;
