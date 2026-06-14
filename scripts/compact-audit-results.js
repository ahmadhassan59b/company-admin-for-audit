const db = require('../src/config/db');

async function getAuditResultsSize() {
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS row_count,
      pg_size_pretty(COALESCE(SUM(pg_column_size(snapshot_json)), 0)) AS snapshot_size,
      pg_size_pretty(COALESCE(SUM(pg_column_size(rules_json)), 0)) AS rules_size,
      pg_size_pretty(COALESCE(SUM(pg_column_size(report_json)), 0)) AS report_size,
      pg_size_pretty(COALESCE(SUM(pg_column_size(snapshot_json) + pg_column_size(rules_json) + pg_column_size(report_json)), 0)) AS total_json_size
    FROM audit_results
  `);

  return result.rows[0];
}

async function main() {
  const before = await getAuditResultsSize();

  const compacted = await db.query(`
    UPDATE audit_results
    SET report_json = report_json - 'snapshot' - 'rules'
    WHERE report_json ? 'snapshot'
       OR report_json ? 'rules'
  `);

  const after = await getAuditResultsSize();

  console.log('audit_results compacted');
  console.table({
    before,
    after,
    updated_rows: { row_count: compacted.rowCount }
  });
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end());
}

module.exports = {
  main
};
