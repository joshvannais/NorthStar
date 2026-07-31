'use strict';

const https = require('https');
const request = require('supertest');

async function main() {
  if (!process.env.DATABASE_URL || !process.env.AUTH_ACCESS_SECRET) {
    throw new Error('worker PostgreSQL and authentication identity are required');
  }
  const db = require('../../src/db');
  if (!await db.initDatabase()) throw new Error('worker database readiness failed');

  let exchangeCalls = 0;
  let saveCalls = 0;
  https.request = function unexpectedProviderRequest() {
    throw new Error('provider transmission is forbidden in the OAuth state worker');
  };
  const jobber = require('../../src/integrations/jobber');
  jobber.exchangeCode = async function interceptedExchange() {
    exchangeCalls += 1;
    return {
      access_token: 'intercepted-worker-access',
      refresh_token: 'intercepted-worker-refresh',
      expires_in: 3600,
    };
  };

  const appOptions = {};
  if (process.env.JOBBER_TEST_CONNECTION_CAPABILITY === 'intercepted-canonical-postgresql') {
    appOptions.jobberConnectionCapability = {
      stateAuthority: require('../../src/integrations/oauthAuthorizationState'),
      async persistConnection() {
        saveCalls += 1;
        return true;
      },
      async readConnectionStatus() {
        return { connected: false };
      },
      async disconnectConnection() {
        return true;
      },
    };
  }
  const app = require('./account-test-app').createDisposableAccountApp(appOptions);
  if (process.send) process.send({ type: 'ready' });
  process.once('message', async message => {
    try {
      const response = await request(app)
        .get('/api/integrations/jobber/callback')
        .set('Cookie', message.cookie)
        .query({ code: 'intercepted-worker-code', state: message.state });
      if (process.send) {
        process.send({
          type: 'result',
          status: response.status,
          code: response.body && response.body.code,
          exchangeCalls,
          saveCalls,
        });
      }
    } catch (error) {
      if (process.send) process.send({ type: 'error', code: error.code || 'worker_callback_failed' });
    } finally {
      await db.close();
      if (process.connected) process.disconnect();
    }
  });
}

main().catch(async error => {
  if (process.send) process.send({ type: 'error', code: error.code || 'worker_startup_failed' });
  process.exitCode = 1;
});
