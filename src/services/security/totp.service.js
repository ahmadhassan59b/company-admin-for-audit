const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function randomBase32Secret(lengthBytes = 20) {
  return base32Encode(crypto.randomBytes(lengthBytes));
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of Buffer.from(buffer)) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const clean = String(input || '')
    .toUpperCase()
    .replace(/=+/g, '')
    .replace(/[^A-Z2-7]/g, '');

  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateHotp(secret, counter, digits = DIGITS) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, '0');
}

function generateTotp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  return generateHotp(secret, counter);
}

function verifyTotp(secret, token, timestamp = Date.now(), window = 2) {
  const normalizedToken = String(token || '')
    .replace(/\D/g, '')
    .trim();
  if (!/^\d{6}$/.test(normalizedToken)) return false;

  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateHotp(secret, counter + offset);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalizedToken))) {
      return true;
    }
  }

  return false;
}

function buildOtpauthUri({ secret, accountLabel, issuer = 'HubAudit' }) {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS)
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  randomBase32Secret,
  generateTotp,
  verifyTotp,
  buildOtpauthUri
};
