'use strict';

async function main(message) {
  if (!message || message.action !== 'aggregate' || !process.env.DATABASE_URL) {
    throw new Error('invalid_lane5_observability_worker_request');
  }
  const count = Number(message.count);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('invalid_lane5_observability_worker_count');
  }
  const observedAt = new Date(message.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new Error('invalid_lane5_observability_worker_time');

  const db = require('../../src/db');
  try {
    if (!await db.initDatabase()) throw new Error('worker_database_unavailable');
    const audit = require('../../src/audit/client');
    await Promise.all(Array.from({ length: count }, () => audit.recordAnonymousNotFound({
      method: message.method,
      observedAt,
    })));
    return count;
  } finally {
    await db.close();
  }
}

process.once('message', message => {
  main(message).then(count => {
    if (process.send) process.send({ type: 'result', processId: process.pid, count });
  }).catch(error => {
    process.exitCode = 1;
    if (process.send) process.send({ type: 'error', code: error.message || 'worker_failed' });
  }).finally(() => {
    if (process.connected) process.disconnect();
  });
});
