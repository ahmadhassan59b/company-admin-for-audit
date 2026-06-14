const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000
});

function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  pool,
  query
};
