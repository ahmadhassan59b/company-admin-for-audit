const crypto = require('crypto');
const env = require('../../config/env');

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value) {
  return crypto
    .createHmac('sha256', env.authJwtSecret)
    .update(value)
    .digest('base64url');
}

function issueToken(user) {
  const header = base64UrlJson({
    alg: 'HS256',
    typ: 'JWT'
  });
  const payload = base64UrlJson({
    sub: user.id,
    email: user.email,
    tenantId: user.tenant_id,
    role: user.role || 'user',
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    emailVerified: Boolean(user.email_verified_at),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  });
  const unsigned = `${header}.${payload}`;

  return `${unsigned}.${sign(unsigned)}`;
}

function verifyToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const unsigned = `${header}.${payload}`;
    const expected = sign(unsigned);

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null;
    }

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return claims;
  } catch (error) {
    return null;
  }
}

module.exports = {
  issueToken,
  verifyToken
};
