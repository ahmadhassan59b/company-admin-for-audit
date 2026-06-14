const crypto = require('crypto');

const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST)
    .toString('base64url');

  return `pbkdf2:${ITERATIONS}:${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  try {
    if (!passwordHash || !password) return false;

    const [scheme, iterationsValue, salt, expectedHash] = String(passwordHash).split(':');
    if (scheme !== 'pbkdf2' || !iterationsValue || !salt || !expectedHash) {
      return false;
    }

    const iterations = Number(iterationsValue);
    if (!Number.isFinite(iterations) || iterations <= 0) {
      return false;
    }

    const calculatedHash = crypto
      .pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST)
      .toString('base64url');

    const calculatedBuffer = Buffer.from(calculatedHash);
    const expectedBuffer = Buffer.from(expectedHash);
    if (calculatedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(calculatedBuffer, expectedBuffer);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword
};
