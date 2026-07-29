'use strict';

const { Pool } = require('pg');
const { ingestLead } = require('../../src/services/canonicalGraphService');

const pool = new Pool({ connectionString: process.env.M19_CLIENT_TERMINATION_DATABASE_URL, max: 4 });
let savedInput = null;

process.on('message', async function (message) {
  try {
    if (message.type === 'run') {
      savedInput = message.input;
      const result = await ingestLead(pool, savedInput, { waitMs: 10, maxWaitMs: 10000 });
      const health = await pool.query('SELECT 1 AS healthy');
      process.send({ type: 'first', result, healthy: health.rows[0].healthy, processId: process.pid });
      return;
    }
    if (message.type === 'retry') {
      const result = await ingestLead(pool, savedInput, { waitMs: 10, maxWaitMs: 10000 });
      process.send({ type: 'retry', result, processId: process.pid });
      return;
    }
    if (message.type === 'close') {
      await pool.end();
      process.send({ type: 'closed' });
      process.disconnect();
    }
  } catch (error) {
    if (process.connected) process.send({ type: 'error', code: error.code || error.message, processId: process.pid });
  }
});
