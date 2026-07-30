'use strict';

async function main() {
  const db = require('../../src/db');
  if (!await db.initDatabase()) throw new Error('worker database readiness failed');
  const { AccountService } = require('../../src/accounts/service');
  const service = new AccountService();
  if (process.send) process.send({ type: 'ready' });

  process.once('message', async message => {
    try {
      if (message.action === 'logout') {
        await service.logout(message.refreshToken, message.csrfToken, message.csrfToken);
        if (process.send) process.send({ type: 'result', outcome: 'logged_out' });
      } else {
        await service.refresh(message.refreshToken, message.csrfToken, message.csrfToken);
        if (process.send) process.send({ type: 'result', outcome: 'rotated' });
      }
    } catch (error) {
      if (process.send) process.send({ type: 'result', outcome: error.code || 'worker_error' });
    } finally {
      await db.close();
      process.disconnect();
    }
  });
}

main().catch(async error => {
  if (process.send) process.send({ type: 'error', code: error.code || 'worker_startup_error' });
  process.exitCode = 1;
});
