'use strict';

const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

function runWorker(connectionString, secret, material) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, '../helpers/account-refresh-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        AUTH_ACCESS_SECRET: secret,
        ACCOUNT_SIGNUP_ENABLED: 'true',
        ACCOUNT_VERIFICATION_DELIVERY_READY: 'false',
      },
      silent: true,
    });
    let stderr = '';
    let settled = false;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', message => {
      if (message.type === 'ready') {
        child.send({ refreshToken: material.refreshToken, csrfToken: material.csrfToken });
      } else if (message.type === 'result') {
        settled = true;
        resolve(message.outcome);
      } else if (message.type === 'error') {
        settled = true;
        reject(new Error(`${message.code}\n${stderr}`));
      }
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (!settled) reject(new Error(`refresh worker exited before result: ${code}\n${stderr}`));
    });
  });
}

realPostgres('Account refresh authority across Node processes', () => {
  let allocation;
  let db;
  let pool;
  const originals = {};

  beforeAll(async () => {
    allocation = await createSuiteDatabase('account-refresh-race');
    for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET', 'ACCOUNT_SIGNUP_ENABLED', 'ACCOUNT_VERIFICATION_DELIVERY_READY']) {
      originals[key] = process.env[key];
    }
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'false';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (allocation) await allocation.cleanup();
    Object.entries(originals).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }, 60000);

  test('two processes racing one refresh token yield one rotation and one replay, then revoke the family', async () => {
    const { AccountService } = require('../../src/accounts/service');
    const service = new AccountService();
    const signup = await service.signup({
      name: 'Process Owner',
      businessName: 'Process Refresh Company',
      phone: '8605550188',
      email: 'process-refresh@example.test',
      password: 'process password 123',
    }, '127.0.0.1');

    const outcomes = await Promise.all([
      runWorker(allocation.connectionString, process.env.AUTH_ACCESS_SECRET, signup.material),
      runWorker(allocation.connectionString, process.env.AUTH_ACCESS_SECRET, signup.material),
    ]);
    expect(outcomes.sort()).toEqual(['refresh_replay', 'rotated']);

    const state = await pool.query(
      `SELECT session.status AS session_status,
              count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
              count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
         FROM auth_sessions session
         JOIN auth_refresh_tokens token ON token.session_id = session.id
        WHERE session.id = $1
        GROUP BY session.id`,
      [signup.material.sessionId]
    );
    expect(state.rows).toEqual([{ session_status: 'revoked', active_tokens: 0, reused_tokens: 1 }]);
  }, 60000);
});
