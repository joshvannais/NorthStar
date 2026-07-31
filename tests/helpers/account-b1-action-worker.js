'use strict';

async function main(message) {
  if (!message || !['verify', 'reset'].includes(message.action) ||
      typeof message.token !== 'string' || !process.env.DATABASE_URL) {
    throw new Error('invalid_account_b1_worker_request');
  }
  const db = require('../../src/db');
  try {
    if (!await db.initDatabase()) throw new Error('worker_database_unavailable');
    const { AccountService } = require('../../src/accounts/service');
    const service = new AccountService();
    if (message.action === 'verify') {
      await service.verifyEmail(message.token);
    } else {
      await service.resetPassword({ token: message.token, password: message.password }, message.requestIp);
    }
    return { outcome: 'success' };
  } catch (error) {
    return { outcome: error && error.code || error && error.message || 'worker_failed' };
  } finally {
    await db.close();
  }
}

process.once('message', message => {
  main(message).then(result => {
    if (process.send) process.send({ type: 'result', processId: process.pid, ...result });
  }).catch(error => {
    process.exitCode = 1;
    if (process.send) process.send({ type: 'error', code: error.message || 'worker_failed' });
  }).finally(() => {
    if (process.connected) process.disconnect();
  });
});
