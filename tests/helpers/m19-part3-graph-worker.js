'use strict';

const { Pool } = require('pg');
const { ingestSimulation } = require('../../src/services/canonicalGraphService');

process.on('message', async function (message) {
  if (!message || message.type !== 'run') return;
  const pool = new Pool({
    connectionString: process.env.M19_PART3_FAILURE_DATABASE_URL,
    max: 20,
  });
  try {
    const results = await Promise.all(Array.from({ length: message.count }, function () {
      return ingestSimulation(pool, message.input, { waitMs: 10, maxWaitMs: 15000 });
    }));
    if (process.send) process.send({ type: 'result', results });
  } catch (error) {
    if (process.send) process.send({ type: 'error', code: error.code || 'worker_failure' });
  } finally {
    await pool.end();
    process.disconnect();
  }
});
