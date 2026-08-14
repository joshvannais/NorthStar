'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const PROVIDER_ENVIRONMENT = [
  'RETELL_API_KEY',
  'RETELL_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
];

function bcryptPrefix(hash, prefix) {
  return `${hash.slice(0, 2)}${prefix}${hash.slice(3)}`;
}

function currentPasswordMaterial(password) {
  return `northstar-sha512:${crypto.createHash('sha512').update(password, 'utf8').digest('base64')}`;
}

function publicBody(response) {
  const { requestId: _requestId, ...body } = response.body;
  return body;
}

function cookieHeader(response) {
  return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

describe('Mission 20 Phase 7 password-reset/login transaction authority', () => {
  let allocation;
  let db;
  let pool;
  let bcrypt;
  let repository;
  let priorDatabaseUrl;
  let priorFetch;
  let providerCalls;
  let loginDelays;
  let sourceSequence = 20;

  function source() {
    sourceSequence += 1;
    return `198.51.100.${sourceSequence}`;
  }

  function mountedApp(selectedRepository = repository) {
    const { AccountService } = require('../../src/accounts/service');
    const { createAuthRouter } = require('../../src/routes/auth');
    const service = new AccountService(selectedRepository, {
      sleep: async milliseconds => { loginDelays.push(milliseconds); },
    });
    const app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.locals.accountRepository = selectedRepository;
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({ service }));
    return app;
  }

  async function storedHash(password, configuration) {
    const { hashPassword } = require('../../src/accounts/service');
    if (configuration.material === 'canonical') return hashPassword(password);
    const material = configuration.material === 'raw'
      ? password
      : currentPasswordMaterial(password);
    return bcryptPrefix(await bcrypt.hash(material, configuration.cost), configuration.prefix);
  }

  async function seedAccount(configuration, label) {
    const { hashPassword } = require('../../src/accounts/service');
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const oldPassword = `Old-${label}-password!`;
    const newPassword = `New-${label}-password!`;
    const oldHash = await storedHash(oldPassword, configuration);
    const newHash = await hashPassword(newPassword);
    const tokenHash = crypto.createHash('sha256').update(`${label}-${tokenId}`).digest('hex');
    await pool.query(
      'INSERT INTO organizations (id, name, owner_name, email, phone) VALUES ($1,$2,$3,$4,$5)',
      [organizationId, `Race ${label}`, 'Race Owner', email, '']
    );
    await pool.query(
      `INSERT INTO users
        (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
       VALUES ($1,$2,'Race Owner',$3,$3,$4,'','owner','active')`,
      [userId, organizationId, email, oldHash]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'owner','active')`,
      [membershipId, organizationId, userId]
    );
    await pool.query(
      `INSERT INTO organization_onboarding (organization_id, status)
       VALUES ($1,'business_profile_required')`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO account_action_tokens
        (id, user_id, organization_id, purpose, token_hash, expires_at)
       VALUES ($1,$2,$3,'password_reset',$4,NOW() + INTERVAL '30 minutes')`,
      [tokenId, userId, organizationId, tokenHash]
    );
    return {
      ...configuration,
      organizationId,
      userId,
      tokenId,
      email,
      oldPassword,
      newPassword,
      oldHash,
      newHash,
      tokenHash,
    };
  }

  async function durableState(account) {
    const authority = (await pool.query(
      `SELECT u.password_hash,
              u.xmin::text::bigint AS user_xid,
              t.consumed_at,
              t.xmin::text::bigint AS reset_xid
         FROM users u
         JOIN account_action_tokens t ON t.user_id = u.id
        WHERE u.id = $1 AND t.id = $2`,
      [account.userId, account.tokenId]
    )).rows[0];
    const sessions = (await pool.query(
      `SELECT id, status, revoke_reason, xmin::text::bigint AS insert_xid
         FROM auth_sessions WHERE user_id = $1 ORDER BY created_at`,
      [account.userId]
    )).rows;
    const refreshTokens = (await pool.query(
      `SELECT token.status, token.revoke_reason
         FROM auth_refresh_tokens token
         JOIN auth_sessions session ON session.id = token.session_id
        WHERE session.user_id = $1`,
      [account.userId]
    )).rows;
    const passwordUpdates = (await pool.query(
      `SELECT old_hash, new_hash, transaction_id
         FROM pr122_password_update_audit
        WHERE user_id = $1 ORDER BY sequence`,
      [account.userId]
    )).rows;
    const sessionInserts = (await pool.query(
      `SELECT session_id, transaction_id
         FROM pr122_session_insert_audit
        WHERE user_id = $1 ORDER BY sequence`,
      [account.userId]
    )).rows;
    return { ...authority, sessions, refreshTokens, passwordUpdates, sessionInserts };
  }

  async function assertLaterPasswords(account) {
    const app = mountedApp();
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source())
      .send({ email: account.email, password: account.oldPassword });
    expect(oldLogin.status).toBe(401);
    expect(publicBody(oldLogin)).toEqual({
      error: 'Invalid email or password', code: 'invalid_credentials',
    });
    const newLogin = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source())
      .send({ email: account.email, password: account.newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.headers['set-cookie']).toHaveLength(3);
    await pool.query(
      `DELETE FROM auth_refresh_tokens WHERE session_id IN
        (SELECT id FROM auth_sessions WHERE user_id = $1)`,
      [account.userId]
    );
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [account.userId]);
  }

  async function assertResetFirstResult(account, app, login, resetState, delayStart) {
    const { verifyPassword } = require('../../src/accounts/service');
    expect(login.status).toBe(401);
    expect(publicBody(login)).toEqual({
      error: 'Invalid email or password', code: 'invalid_credentials',
    });
    expect(login.headers['set-cookie']).toBeUndefined();
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(publicBody(me)).toEqual({ error: 'Authentication required', code: 'unauthorized' });
    const finalState = await durableState(account);
    expect(finalState.password_hash).toBe(account.newHash);
    expect(finalState.consumed_at).not.toBeNull();
    expect(finalState.sessions).toEqual([]);
    expect(finalState.refreshTokens).toEqual([]);
    expect(finalState.sessionInserts).toEqual([]);
    expect(finalState.passwordUpdates).toEqual([{
      old_hash: account.oldHash,
      new_hash: account.newHash,
      transaction_id: resetState.reset_xid,
    }]);
    expect((await verifyPassword(account.oldPassword, finalState.password_hash)).valid).toBe(false);
    expect((await verifyPassword(account.newPassword, finalState.password_hash)).valid).toBe(true);
    expect(loginDelays.slice(delayStart)).toEqual([0]);
    expect(providerCalls).toBe(0);
    await assertLaterPasswords(account);
  }

  async function deterministicResetFirst(configuration, label) {
    const account = await seedAccount(configuration, label);
    let signalRead;
    let releaseRead;
    const authorityRead = new Promise(resolve => { signalRead = resolve; });
    const mayReturnAuthority = new Promise(resolve => { releaseRead = resolve; });
    const gatedRepository = new Proxy(repository, {
      get(target, property) {
        if (property === 'findLoginAuthority') {
          return async normalizedEmail => {
            const authority = await target.findLoginAuthority(normalizedEmail);
            signalRead(authority);
            await mayReturnAuthority;
            return authority;
          };
        }
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const app = mountedApp(gatedRepository);
    const delayStart = loginDelays.length;
    const loginPromise = request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source())
      .send({ email: account.email, password: account.oldPassword })
      .then(response => response);
    const authority = await authorityRead;
    expect(authority.password_hash).toBe(account.oldHash);
    expect(await repository.resetPasswordWithToken({
      tokenHash: account.tokenHash,
      passwordHash: account.newHash,
    })).not.toBeNull();
    const resetState = await durableState(account);
    expect(resetState.password_hash).toBe(account.newHash);
    expect(resetState.sessions).toEqual([]);
    releaseRead();
    const login = await loginPromise;
    await assertResetFirstResult(account, app, login, resetState, delayStart);
  }

  async function ungatedResetFirst(configuration, label) {
    const account = await seedAccount(configuration, label);
    const app = mountedApp();
    const originalCompare = bcrypt.compare;
    let compareStarts = 0;
    let signalComparison;
    const comparisonStarted = new Promise(resolve => { signalComparison = resolve; });
    bcrypt.compare = function observedCompare(...args) {
      compareStarts += 1;
      if (compareStarts === 1) signalComparison();
      return originalCompare.apply(this, args);
    };
    let login;
    let resetState;
    const delayStart = loginDelays.length;
    try {
      const loginPromise = request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', source())
        .send({ email: account.email, password: account.oldPassword })
        .then(response => response);
      let timeout;
      try {
        await Promise.race([
          comparisonStarted,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Bcrypt comparison start timed out')), 20000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      expect(await repository.resetPasswordWithToken({
        tokenHash: account.tokenHash,
        passwordHash: account.newHash,
      })).not.toBeNull();
      resetState = await durableState(account);
      login = await loginPromise;
    } finally {
      bcrypt.compare = originalCompare;
    }
    expect(compareStarts).toBeGreaterThanOrEqual(1);
    await assertResetFirstResult(account, app, login, resetState, delayStart);
  }

  async function waitForActivity(fragment) {
    const deadline = Date.now() + 20000;
    do {
      const rows = (await pool.query(
        `SELECT pid, wait_event_type, wait_event, query
           FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND state = 'active' AND query LIKE $1`,
        [`%${fragment}%`]
      )).rows;
      const waiting = rows.find(row => row.wait_event_type === 'Lock');
      if (waiting) return waiting;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for PostgreSQL activity: ${fragment}`);
  }

  async function loginFirstThenReset(configuration, label, lockKey) {
    const account = await seedAccount(configuration, label);
    await pool.query(
      'INSERT INTO pr122_login_session_blocks (user_id, lock_key) VALUES ($1,$2)',
      [account.userId, lockKey]
    );
    const blocker = await pool.connect();
    let lockHeld = false;
    try {
      await blocker.query('SELECT pg_advisory_lock($1)', [lockKey]);
      lockHeld = true;
      const app = mountedApp();
      const loginPromise = request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', source())
        .send({ email: account.email, password: account.oldPassword })
        .then(response => response);
      const loginWait = await waitForActivity('INSERT INTO auth_sessions');
      expect(loginWait.wait_event).toBe('advisory');
      const resetPromise = repository.resetPasswordWithToken({
        tokenHash: account.tokenHash,
        passwordHash: account.newHash,
      });
      const resetWait = await waitForActivity('FROM account_action_tokens t');
      expect(['transactionid', 'tuple']).toContain(resetWait.wait_event);
      expect((await blocker.query('SELECT pg_advisory_unlock($1) AS unlocked', [lockKey])).rows[0].unlocked)
        .toBe(true);
      lockHeld = false;
      const [login, reset] = await Promise.all([loginPromise, resetPromise]);
      expect(reset).not.toBeNull();
      expect(login.status).toBe(200);
      expect(login.headers['set-cookie']).toHaveLength(3);
      const finalState = await durableState(account);
      expect(finalState.password_hash).toBe(account.newHash);
      expect(finalState.consumed_at).not.toBeNull();
      expect(finalState.sessions).toHaveLength(1);
      expect(finalState.sessionInserts).toHaveLength(1);
      expect(finalState.sessions[0].status).toBe('revoked');
      expect(finalState.sessions[0].revoke_reason).toBe('password_reset');
      expect(Number(finalState.sessionInserts[0].transaction_id)).toBeLessThan(Number(finalState.reset_xid));
      expect(finalState.refreshTokens).toEqual([{
        status: 'revoked', revoke_reason: 'password_reset',
      }]);
      const expectedUpdates = configuration.material === 'canonical' ? 1 : 2;
      expect(finalState.passwordUpdates).toHaveLength(expectedUpdates);
      if (expectedUpdates === 2) {
        expect(finalState.passwordUpdates[0].old_hash).toBe(account.oldHash);
        expect(finalState.passwordUpdates[0].new_hash).toMatch(/^\$2b\$12\$/);
        expect(Number(finalState.passwordUpdates[0].transaction_id))
          .toBe(Number(finalState.sessionInserts[0].transaction_id));
      }
      const resetUpdate = finalState.passwordUpdates[expectedUpdates - 1];
      expect(resetUpdate.new_hash).toBe(account.newHash);
      expect(Number(resetUpdate.transaction_id)).toBe(Number(finalState.reset_xid));
      const me = await request(app)
        .get('/api/auth/me')
        .set('Cookie', cookieHeader(login));
      expect(me.status).toBe(401);
      expect(publicBody(me)).toEqual({
        error: 'Session is no longer active', code: 'session_inactive',
      });
      expect(providerCalls).toBe(0);
      await assertLaterPasswords(account);
    } finally {
      if (lockHeld) await blocker.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      blocker.release();
      await pool.query('DELETE FROM pr122_login_session_blocks WHERE user_id = $1', [account.userId]);
    }
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Task-owned PostgreSQL 18.4 identity is required for login/reset race safety');
    }
    for (const name of PROVIDER_ENVIRONMENT) expect(process.env[name]).toBeUndefined();
    allocation = await createSuiteDatabase('m20 phase7 login reset race');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    bcrypt = require('bcryptjs');
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    expect((await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('max_connections')::int AS max_connections`
    )).rows[0]).toEqual({
      version: '18.4', timezone: 'UTC', checksums: 'on', max_connections: 100,
    });
    const { AccountRepository } = require('../../src/accounts/repository');
    repository = new AccountRepository(pool);
    priorFetch = global.fetch;
    providerCalls = 0;
    loginDelays = [];
    global.fetch = async () => {
      providerCalls += 1;
      throw new Error('Provider network access is forbidden in login/reset race tests');
    };
    await pool.query(`
      CREATE TABLE pr122_password_update_audit (
        sequence BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        old_hash TEXT NOT NULL,
        new_hash TEXT NOT NULL,
        transaction_id BIGINT NOT NULL
      );
      CREATE FUNCTION pr122_audit_password_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_password_update_audit (user_id, old_hash, new_hash, transaction_id)
        VALUES (NEW.id, OLD.password_hash, NEW.password_hash, txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_password_update
        AFTER UPDATE OF password_hash ON users
        FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
        EXECUTE FUNCTION pr122_audit_password_update();
      CREATE TABLE pr122_session_insert_audit (
        sequence BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        session_id UUID NOT NULL,
        transaction_id BIGINT NOT NULL
      );
      CREATE FUNCTION pr122_audit_session_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_session_insert_audit (user_id, session_id, transaction_id)
        VALUES (NEW.user_id, NEW.id, txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_session_insert
        AFTER INSERT ON auth_sessions
        FOR EACH ROW EXECUTE FUNCTION pr122_audit_session_insert();
      CREATE TABLE pr122_login_session_blocks (
        user_id UUID PRIMARY KEY,
        lock_key BIGINT NOT NULL
      );
      CREATE FUNCTION pr122_block_login_session_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE selected_lock BIGINT;
      BEGIN
        SELECT lock_key INTO selected_lock FROM pr122_login_session_blocks WHERE user_id = NEW.user_id;
        IF FOUND THEN PERFORM pg_advisory_xact_lock(selected_lock); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_block_login_session_insert
        BEFORE INSERT ON auth_sessions
        FOR EACH ROW EXECUTE FUNCTION pr122_block_login_session_insert();
    `);
  }, 60000);

  beforeEach(async () => {
    providerCalls = 0;
    loginDelays.length = 0;
    await pool.query('DELETE FROM auth_refresh_tokens');
    await pool.query('DELETE FROM auth_sessions');
    await pool.query('DELETE FROM auth_rate_limits');
    await pool.query('DELETE FROM pr122_login_session_blocks');
  });

  afterAll(async () => {
    global.fetch = priorFetch;
    if (pool) {
      await pool.query(`
        DROP TRIGGER IF EXISTS pr122_block_login_session_insert ON auth_sessions;
        DROP FUNCTION IF EXISTS pr122_block_login_session_insert();
        DROP TABLE IF EXISTS pr122_login_session_blocks;
        DROP TRIGGER IF EXISTS pr122_audit_session_insert ON auth_sessions;
        DROP FUNCTION IF EXISTS pr122_audit_session_insert();
        DROP TABLE IF EXISTS pr122_session_insert_audit;
        DROP TRIGGER IF EXISTS pr122_audit_password_update ON users;
        DROP FUNCTION IF EXISTS pr122_audit_password_update();
        DROP TABLE IF EXISTS pr122_password_update_audit;
      `);
    }
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  }, 60000);

  test('reset-first rejects stale deterministic canonical, raw, and current-material logins', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warningLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await deterministicResetFirst(
        { material: 'canonical', prefix: 'b', cost: 12 },
        `det-canonical-${crypto.randomUUID()}`
      );
      await deterministicResetFirst(
        { material: 'raw', prefix: 'a', cost: 4 },
        `det-raw-${crypto.randomUUID()}`
      );
      await deterministicResetFirst(
        { material: 'current', prefix: 'y', cost: 9 },
        `det-current-${crypto.randomUUID()}`
      );
      expect(errorLog).not.toHaveBeenCalled();
      expect(warningLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      warningLog.mockRestore();
    }
  }, 120000);

  test('ordinary ungated reset-first rejects canonical, raw, and current-material logins', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warningLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ungatedResetFirst(
        { material: 'canonical', prefix: 'b', cost: 12 },
        `natural-canonical-${crypto.randomUUID()}`
      );
      await ungatedResetFirst(
        { material: 'raw', prefix: 'y', cost: 8 },
        `natural-raw-${crypto.randomUUID()}`
      );
      await ungatedResetFirst(
        { material: 'current', prefix: 'a', cost: 5 },
        `natural-current-${crypto.randomUUID()}`
      );
      expect(errorLog).not.toHaveBeenCalled();
      expect(warningLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
      warningLog.mockRestore();
    }
  }, 120000);

  test('login-first serializes canonical and supported upgrades before reset revokes the committed session', async () => {
    await loginFirstThenReset(
      { material: 'canonical', prefix: 'b', cost: 12 },
      `first-canonical-${crypto.randomUUID()}`,
      122001
    );
    await loginFirstThenReset(
      { material: 'raw', prefix: 'b', cost: 11 },
      `first-raw-${crypto.randomUUID()}`,
      122002
    );
    await loginFirstThenReset(
      { material: 'current', prefix: 'y', cost: 12 },
      `first-current-${crypto.randomUUID()}`,
      122003
    );
  }, 120000);

  test('session transaction failure rolls back supported upgrade and both credential inserts', async () => {
    const account = await seedAccount(
      { material: 'raw', prefix: 'a', cost: 4 },
      `rollback-${crypto.randomUUID()}`
    );
    await pool.query(`
      CREATE FUNCTION pr122_fail_refresh_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected login refresh rollback'; END $$;
      CREATE TRIGGER pr122_fail_refresh_insert
        BEFORE INSERT ON auth_refresh_tokens
        FOR EACH ROW EXECUTE FUNCTION pr122_fail_refresh_insert();
    `);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = mountedApp();
      const response = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', source())
        .send({ email: account.email, password: account.oldPassword });
      expect(response.status).toBe(500);
      expect(publicBody(response)).toEqual({
        error: 'Authentication request failed', code: 'auth_request_failed',
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith('[Auth] Request failed:', {
        requestId: 'unavailable', event: 'login_failed',
      });
      const state = await durableState(account);
      expect(state.password_hash).toBe(account.oldHash);
      expect(state.sessions).toEqual([]);
      expect(state.refreshTokens).toEqual([]);
      expect(state.sessionInserts).toEqual([]);
      expect(state.passwordUpdates).toEqual([]);
      expect(providerCalls).toBe(0);
    } finally {
      errorLog.mockRestore();
      await pool.query('DROP TRIGGER IF EXISTS pr122_fail_refresh_insert ON auth_refresh_tokens');
      await pool.query('DROP FUNCTION IF EXISTS pr122_fail_refresh_insert()');
    }
    const recovered = await request(mountedApp())
      .post('/api/auth/login')
      .set('X-Forwarded-For', source())
      .send({ email: account.email, password: account.oldPassword });
    expect(recovered.status).toBe(200);
    const state = await durableState(account);
    expect(state.password_hash).not.toBe(account.oldHash);
    expect(state.password_hash).toMatch(/^\$2b\$12\$/);
    expect(state.sessions).toHaveLength(1);
    expect(state.refreshTokens).toEqual([{ status: 'active', revoke_reason: null }]);
    expect(providerCalls).toBe(0);
  }, 60000);
});
