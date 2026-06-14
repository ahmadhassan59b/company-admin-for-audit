const zlib = require('zlib');
const db = require('../../config/db');
const env = require('../../config/env');

async function getCachedAiResult(hash) {
  if (!hash) return null;

  const result = await db.query(
    `
      SELECT result, compressed_result, compression, expires_at
      FROM audit_cache
      WHERE hash = $1
      LIMIT 1
    `,
    [hash]
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0];
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }

  if (row.compressed_result) {
    return decompressJson(row.compressed_result, row.compression);
  }

  return row.result || null;
}

async function saveCachedAiResult(hash, result, meta = {}) {
  if (!hash || !result) return null;

  const serialized = JSON.stringify(result);
  const compression = 'gzip';
  const compressedResult = zlib.gzipSync(serialized);
  const ttlSeconds = Number.isFinite(Number(meta.ttlSeconds))
    ? Number(meta.ttlSeconds)
    : Number.isFinite(Number(env.aiCacheTtlSeconds))
      ? Number(env.aiCacheTtlSeconds)
      : 3600;
  const expiresAt = new Date(Date.now() + Math.max(ttlSeconds, 60) * 1000);

  await db.query(
    `
      INSERT INTO audit_cache (
        hash,
        result,
        compressed_result,
        compression,
        expires_at,
        input_chars,
        output_chars,
        cache_mode,
        estimated_cost,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (hash)
      DO UPDATE SET
        result = EXCLUDED.result,
        compressed_result = EXCLUDED.compressed_result,
        compression = EXCLUDED.compression,
        expires_at = EXCLUDED.expires_at,
        input_chars = EXCLUDED.input_chars,
        output_chars = EXCLUDED.output_chars,
        cache_mode = EXCLUDED.cache_mode,
        estimated_cost = EXCLUDED.estimated_cost
    `,
    [
      hash,
      null,
      compressedResult,
      compression,
      expiresAt,
      Number(meta.inputChars || 0),
      Number(meta.outputChars || 0),
      meta.cacheMode || null,
      Number(meta.estimatedCost || 0)
    ]
  );
}

function decompressJson(buffer, compression) {
  if (!buffer) return null;

  if (compression === 'gzip') {
    const decompressed = zlib.gunzipSync(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    return JSON.parse(decompressed.toString('utf8'));
  }

  return JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
}

module.exports = {
  getCachedAiResult,
  saveCachedAiResult
};
