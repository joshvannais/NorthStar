'use strict';

const { Pool } = require('pg');
const { runMigrations } = require('../../src/db');

async function main() {
  const connectionString = process.env.M19_MIGRATION_DATABASE_URL;
  const applicationName = process.env.M19_MIGRATION_APPLICATION_NAME;
  if (!connectionString || !applicationName) throw new Error('migration worker identity is incomplete');

  const pool = new Pool({ connectionString, application_name: applicationName, max: 1 });
  if (process.send) process.send({ type: 'ready', processId: process.pid });

  process.once('message', async message => {
    if (!message || message.type !== 'run') return;
    let exitCode = 0;
    let response;
    try {
      await runMigrations({ pool });
      response = { type: 'result', outcome: 'migrated', processId: process.pid };
    } catch (_) {
      response = { type: 'error', code: 'migration_failed', processId: process.pid };
      exitCode = 1;
    } finally {
      if (process.send) {
        await new Promise(resolve => process.send(response, () => resolve()));
      }
      await pool.end().catch(() => {});
      if (process.connected) process.disconnect();
      process.exit(exitCode);
    }
  });
}

main().catch(error => {
  if (process.send) process.send({ type: 'error', code: error.code || 'worker_startup_failed' });
  process.exitCode = 1;
});
