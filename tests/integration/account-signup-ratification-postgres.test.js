'use strict';

const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const SIGNUP_GRAPH_TABLES = Object.freeze([
  'organizations',
  'users',
  'organization_memberships',
  'subscriptions',
  'notification_preferences',
  'organization_account_preferences',
  'organization_onboarding',
  'auth_sessions',
  'auth_refresh_tokens',
]);

function signupBody(email, index) {
  return {
    name: `Boundary Owner ${index}`,
    businessName: `Boundary Business ${index}`,
    phone: `860555${String(2000 + index).slice(-4)}`,
    email,
    password: 'boundary signup password',
  };
}

async function graphCounts(pool) {
  const entries = await Promise.all(SIGNUP_GRAPH_TABLES.map(async table => {
    const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
    return [table, result.rows[0].count];
  }));
  return Object.fromEntries(entries);
}

function runSignupWorker(options) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, '../helpers/account-signup-ratification-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        DATABASE_URL: options.connectionString,
        AUTH_ACCESS_SECRET: options.secret,
      },
      silent: true,
    });
    let message = null;
    let stderrBytes = 0;
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    child.on('message', value => { message = value; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0 && message && message.type === 'result') return resolve(message);
      const failure = message && message.type === 'error' ? message.code : 'worker_exited_without_result';
      return reject(new Error(`${failure}; exit=${code}; stderrBytes=${stderrBytes}`));
    });
    child.send({
      type: 'run',
      count: options.count,
      email: options.email,
      indexOffset: options.indexOffset,
    });
  });
}

describe('mounted signup transaction ratification on physical PostgreSQL', () => {
  let allocation;
  let app;
  let db;
  let pool;
  let secret;
  const originals = {};

  beforeAll(async () => {
    for (const key of [
      'M19_PG_ADMIN_URL', 'M19_EXPECTED_PG_DATA_DIR', 'M19_EXPECTED_PG_PORT', 'M19_TEST_RUN_ID',
    ]) {
      if (!process.env[key]) {
        throw new Error('Disposable PostgreSQL 18 identity is required for signup ratification');
      }
    }
    allocation = await createSuiteDatabase('account-signup-ratification');
    for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET']) originals[key] = process.env[key];
    secret = crypto.randomBytes(48).toString('hex');
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = secret;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    app = require('../helpers/account-signup-ratification-app').createSignupRatificationApp();
    await pool.query(`
      CREATE FUNCTION account_signup_reject_boundary() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'injected signup boundary failure';
      END;
      $$ LANGUAGE plpgsql
    `);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (allocation) await allocation.cleanup();
    Object.entries(originals).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }, 60000);

  test('an injected failure after the durable rate-limit write leaves zero account rows and zero cookies', async () => {
    const beforeGraph = await graphCounts(pool);
    const beforeRateLimits = await pool.query(
      "SELECT count(*)::int AS count FROM auth_rate_limits WHERE event_type = 'signup_ip'"
    );
    await pool.query(`
      CREATE TRIGGER account_signup_reject_boundary_trigger
        AFTER INSERT ON auth_rate_limits
        FOR EACH ROW EXECUTE FUNCTION account_signup_reject_boundary()
    `);
    let response;
    try {
      response = await request(app)
        .post('/api/auth/signup')
        .set('X-Forwarded-For', '203.0.113.250')
        .send(signupBody('boundary-rate-limit@example.test', 250));
    } finally {
      await pool.query('DROP TRIGGER account_signup_reject_boundary_trigger ON auth_rate_limits');
    }
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      code: 'auth_request_failed',
      error: 'Authentication request failed',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await graphCounts(pool)).toEqual(beforeGraph);
    const afterRateLimits = await pool.query(
      "SELECT count(*)::int AS count FROM auth_rate_limits WHERE event_type = 'signup_ip'"
    );
    expect(afterRateLimits.rows[0].count).toBe(beforeRateLimits.rows[0].count);
  }, 60000);

  test.each(SIGNUP_GRAPH_TABLES)(
    'an injected failure after the %s write leaves zero partial graph rows and zero cookies',
    async table => {
      const index = SIGNUP_GRAPH_TABLES.indexOf(table);
      const before = await graphCounts(pool);
      await pool.query(`
        CREATE TRIGGER account_signup_reject_boundary_trigger
          AFTER INSERT ON ${table}
          FOR EACH ROW EXECUTE FUNCTION account_signup_reject_boundary()
      `);
      let response;
      try {
        response = await request(app)
          .post('/api/auth/signup')
          .set('X-Forwarded-For', `203.0.113.${index + 1}`)
          .send(signupBody(`boundary-${index}@example.test`, index));
      } finally {
        await pool.query(`DROP TRIGGER account_signup_reject_boundary_trigger ON ${table}`);
      }

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        code: 'auth_request_failed',
        error: 'Authentication request failed',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/injected|signup boundary|organizations|auth_sessions/i);
      expect(await graphCounts(pool)).toEqual(before);
      const identity = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM organizations WHERE email = $1) AS organizations,
           (SELECT count(*)::int FROM users WHERE email_normalized = $1) AS users`,
        [`boundary-${index}@example.test`]
      );
      expect(identity.rows[0]).toEqual({ organizations: 0, users: 0 });
    },
    60000
  );

  test('32 concurrent mounted requests across two Node processes create exactly one complete account graph', async () => {
    const email = `two-process-${crypto.randomUUID()}@example.test`;
    const [first, second] = await Promise.all([
      runSignupWorker({
        connectionString: allocation.connectionString,
        secret,
        count: 16,
        email,
        indexOffset: 0,
      }),
      runSignupWorker({
        connectionString: allocation.connectionString,
        secret,
        count: 16,
        email,
        indexOffset: 16,
      }),
    ]);
    expect(new Set([first.processId, second.processId, process.pid]).size).toBe(3);
    const results = first.results.concat(second.results);
    expect(results).toHaveLength(32);
    expect(results.filter(result => result.status === 201 && result.cookieCount === 3)).toHaveLength(1);
    expect(results.filter(result => (
      result.status === 409 && result.code === 'account_exists' && result.cookieCount === 0
    ))).toHaveLength(31);

    const graph = await pool.query(
      `SELECT account.id AS user_id,
              account.organization_id,
              (SELECT count(*)::int FROM organizations WHERE id = account.organization_id) AS organizations,
              (SELECT count(*)::int FROM users WHERE email_normalized = $1) AS users,
              (SELECT count(*)::int FROM organization_memberships WHERE user_id = account.id) AS memberships,
              (SELECT count(*)::int FROM subscriptions WHERE organization_id = account.organization_id) AS subscriptions,
              (SELECT count(*)::int FROM notification_preferences WHERE organization_id = account.organization_id) AS notification_preferences,
              (SELECT count(*)::int FROM organization_account_preferences WHERE organization_id = account.organization_id) AS account_preferences,
              (SELECT count(*)::int FROM organization_onboarding WHERE organization_id = account.organization_id) AS onboarding,
              (SELECT count(*)::int FROM auth_sessions WHERE user_id = account.id) AS sessions,
              (SELECT count(*)::int
                 FROM auth_refresh_tokens token
                 JOIN auth_sessions session ON session.id = token.session_id
                WHERE session.user_id = account.id) AS refresh_tokens
         FROM users account
        WHERE account.email_normalized = $1`,
      [email]
    );
    expect(graph.rows).toHaveLength(1);
    expect(graph.rows[0]).toMatchObject({
      organizations: 1,
      users: 1,
      memberships: 1,
      subscriptions: 1,
      notification_preferences: 1,
      account_preferences: 1,
      onboarding: 1,
      sessions: 1,
      refresh_tokens: 1,
    });
  }, 180000);
});
