'use strict';

async function main(message) {
  if (!message || message.action !== 'claim' || !process.env.DATABASE_URL) {
    throw new Error('invalid_lane2_outbox_worker_request');
  }
  const db = require('../../src/db');
  try {
    if (!await db.initDatabase()) throw new Error('worker_database_unavailable');
    const { AccountRepository } = require('../../src/accounts/repository');
    const repository = new AccountRepository();
    const jobs = await repository.claimAccountEmailJobs({
      batchSize: message.batchSize,
      leaseSeconds: message.leaseSeconds,
    });
    return jobs.map(job => ({
      id: job.id,
      purpose: job.purpose,
      attemptCount: job.attempt_count,
      claimToken: job.claim_token,
    }));
  } finally {
    await db.close();
  }
}

process.once('message', message => {
  main(message).then(jobs => {
    if (process.send) process.send({ type: 'result', processId: process.pid, jobs });
  }).catch(error => {
    process.exitCode = 1;
    if (process.send) process.send({ type: 'error', code: error.message || 'worker_failed' });
  }).finally(() => {
    if (process.connected) process.disconnect();
  });
});
