const crypto = require('crypto');
const env = require('../../config/env');

function getKey() {
  return crypto.createHash('sha256').update(String(env.tokenEncryptionKey || '')).digest();
}

function encryptString(value) {
  if (value === null || typeof value === 'undefined') return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptString(value) {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('enc:v1:')) return value;

  const parts = value.split(':');
  if (parts.length !== 5) return null;

  const [, , ivValue, tagValue, encryptedValue] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivValue, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  encryptString,
  decryptString
};
