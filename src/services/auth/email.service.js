const nodemailer = require('nodemailer');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');

let transport;
const SMTP_SEND_TIMEOUT_MS = 60000;

function getFrontendBaseUrl() {
  return env.frontendBaseUrl || env.appBaseUrl;
}

function buildVerificationUrl(token) {
  const url = new URL('/verify-email', getFrontendBaseUrl());
  url.searchParams.set('token', token);
  return url.toString();
}

function buildTransport() {
  if (!env.smtpHost || !env.emailFrom) {
    return null;
  }

  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      family: 4,
      connectionTimeout: 45000,
      greetingTimeout: 45000,
      socketTimeout: 45000,
      auth:
        env.smtpUser && env.smtpPass
          ? {
              user: env.smtpUser,
              pass: env.smtpPass
            }
          : undefined
    });
  }

  return transport;
}

function sendMailWithTimeout(mailTransport, message, timeoutMs = SMTP_SEND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          'Email delivery timed out. Check SMTP_HOST, SMTP_USER, SMTP_PASS, and domain verification.',
          504,
          'email_delivery_timeout'
        )
      );
    }, timeoutMs);

    timer.unref?.();

    mailTransport.sendMail(message).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function ensureEmailDeliveryConfigured() {
  if (buildTransport()) {
    return true;
  }

  if (env.emailDevFallback) {
    return true;
  }

  throw new AppError(
    'Email delivery is not configured. Set SMTP_HOST and EMAIL_FROM.',
    503,
    'email_delivery_not_configured'
  );
}

async function sendVerificationEmail({ to, tenantName, token }) {
  const verificationUrl = buildVerificationUrl(token);
  const subject = `Verify your ${tenantName || 'HubAudit'} account`;
  const text = [
    `Hello,`,
    '',
    `Verify your email address to activate your account:`,
    verificationUrl,
    '',
    'If you did not create this account, you can ignore this email.'
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827">
      <p>Hello,</p>
      <p>Verify your email address to activate your account.</p>
      <p><a href="${verificationUrl}">Verify your email</a></p>
      <p style="color: #6b7280">If you did not create this account, you can ignore this email.</p>
    </div>
  `;

  const mailTransport = buildTransport();

  if (!mailTransport) {
    if (!env.emailDevFallback) {
      throw new AppError(
        'Email delivery is not configured. Set SMTP_HOST and EMAIL_FROM.',
        503,
        'email_delivery_not_configured'
      );
    }

    logger.info('verification_email_fallback', {
      to,
      verificationUrl
    });
    return {
      delivery: 'console',
      verificationUrl
    };
  }

  try {
    await sendMailWithTimeout(mailTransport, {
      from: env.emailFrom,
      to,
      subject,
      text,
      html
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    const responseCode =
      typeof error.responseCode !== 'undefined' ? ` (SMTP ${error.responseCode})` : '';
    const providerMessage = String(error.message || 'unknown error').trim();

    throw new AppError(
      `Email delivery failed${responseCode}: ${providerMessage}`,
      502,
      'email_delivery_failed'
    );
  }

  return {
    delivery: 'smtp',
    verificationUrl
  };
}

module.exports = {
  buildVerificationUrl,
  ensureEmailDeliveryConfigured,
  sendVerificationEmail
};
