const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const logger = require('../src/utils/logger');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasMigrationRun(client, filename) {
  const result = await client.query(
    'SELECT filename FROM schema_migrations WHERE filename = $1',
    [filename]
  );

  return result.rowCount > 0;
}

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    for (const file of files) {
      if (await hasMigrationRun(client, file)) {
        logger.info('Skipping migration', { file });
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      logger.info('Applied migration', { file });
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  logger.error('Migration failed', {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});
