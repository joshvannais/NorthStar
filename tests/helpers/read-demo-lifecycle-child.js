'use strict';

async function main() {
  const db = require('../../src/db');
  const { readDemoLifecycle } = require('../../src/services/demoVoiceLifecycle');
  try {
    const lifecycle = await readDemoLifecycle(
      db.getPool(),
      process.env.NORTHSTAR_DEMO_ORGANIZATION_ID,
      process.argv[2]
    );
    process.stdout.write(JSON.stringify({
      sessionId: lifecycle.session.externalSessionId,
      lifecycle: lifecycle.lifecycle,
      estimateStatus: lifecycle.estimate.status,
      eventCount: lifecycle.entries.length,
    }));
  } finally {
    if (db.getPool()) await db.getPool().end();
  }
}

main().catch(function (error) {
  process.stderr.write(String(error && (error.stack || error.message) || error));
  process.exitCode = 1;
});
