'use strict';

const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      `SELECT organization_id, external_session_id, status,
              business_profile_id, business_profile_version, business_profile_hash
         FROM canonical_voice_sessions
        WHERE organization_id = $1 AND external_session_id = $2`,
      [process.argv[2], process.argv[3]]
    );
    process.stdout.write(JSON.stringify(result.rows));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(String(error && error.stack || error));
  process.exitCode = 1;
});
