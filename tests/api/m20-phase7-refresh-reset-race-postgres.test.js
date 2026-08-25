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

function publicBody(response) {
  const { requestId: _requestId, ...body } = response.body;
  return body;
}

function cookieHeader(response) {
  return (response.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
}

function cookieValue(response, name) {
  const value = (response.headers['set-cookie'] || []).find(item => item.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} cookie`);
  return decodeURIComponent(value.split(';')[0].slice(name.length + 1));
}

describe('Mission 20 Phase 7 password-reset/refresh transaction authority', () => {
  let allocation;
  let db;
  let pool;
  let repository;
  let observedRepository;
  let service;
  let app;
  let credentials;
  let hashPassword;
  let verifyPassword;
  let priorDatabaseUrl;
  let priorFetch;
  let providerCalls;
  let operationErrors;
  let sourceSequence = 20;

  function source() {
    sourceSequence += 1;
    return `198.51.100.${sourceSequence}`;
  }

  async function waitForLock(fragments) {
    const deadline = Date.now() + 20000;
    do {
      const activity = (await pool.query(
        `SELECT pid, wait_event_type, wait_event, query
           FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND state = 'active' AND wait_event_type = 'Lock'`
      )).rows;
      const waiting = activity.find(row => fragments.some(fragment => row.query.includes(fragment)));
      if (waiting) return waiting;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for PostgreSQL lock: ${fragments.join(' | ')}`);
  }

  async function seedAccount(label) {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const resetTokenId = crypto.randomUUID();
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const oldPassword = `Old-${label}-password!`;
    const newPassword = `New-${label}-password!`;
    const rawReset = crypto.randomBytes(32).toString('base64url');
    const oldHash = await hashPassword(oldPassword);
    const newHash = await hashPassword(newPassword);
    await pool.query(
      'INSERT INTO organizations(id,name,owner_name,email,phone) VALUES($1,$2,$3,$4,$5)',
      [organizationId, `Refresh race ${label}`, 'Refresh Race Owner', email, '']
    );
    await pool.query(
      `INSERT INTO users
        (id,organization_id,name,email,email_normalized,password_hash,phone,role,status)
       VALUES($1,$2,'Refresh Race Owner',$3,$3,$4,'','owner','active')`,
      [userId, organizationId, email, oldHash]
    );
    await pool.query(
      `INSERT INTO organization_memberships(id,organization_id,user_id,role,status)
       VALUES($1,$2,$3,'owner','active')`,
      [membershipId, organizationId, userId]
    );
    await pool.query(
      `INSERT INTO organization_onboarding(organization_id,status)
       VALUES($1,'business_profile_required')`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO account_action_tokens(id,user_id,organization_id,purpose,token_hash,expires_at)
       VALUES($1,$2,$3,'password_reset',$4,NOW()+INTERVAL '30 minutes')`,
      [resetTokenId, userId, organizationId, credentials.hashToken(rawReset)]
    );
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', source())
      .send({ email, password: oldPassword });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toHaveLength(3);
    return {
      organizationId,
      userId,
      membershipId,
      resetTokenId,
      email,
      oldPassword,
      newPassword,
      oldHash,
      newHash,
      rawReset,
      login,
      refresh: cookieValue(login, credentials.REFRESH_COOKIE),
      csrf: cookieValue(login, credentials.CSRF_COOKIE),
    };
  }

  async function durableState(account) {
    const authority = (await pool.query(
      `SELECT u.password_hash, reset.consumed_at,
              u.xmin::text::bigint AS user_xid,
              reset.xmin::text::bigint AS reset_xid
         FROM users u
         JOIN account_action_tokens reset ON reset.user_id=u.id
        WHERE u.id=$1 AND reset.id=$2`,
      [account.userId, account.resetTokenId]
    )).rows[0];
    const sessions = (await pool.query(
      `SELECT id,status,revoke_reason,csrf_token_hash,xmin::text::bigint AS row_xid
         FROM auth_sessions WHERE user_id=$1 ORDER BY created_at,id`,
      [account.userId]
    )).rows;
    const tokens = (await pool.query(
      `SELECT token.id,token.session_id,token.family_id,token.parent_token_id,
              token.replaced_by_token_id,token.token_hash,token.status,token.revoke_reason,
              token.xmin::text::bigint AS row_xid
         FROM auth_refresh_tokens token
         JOIN auth_sessions session ON session.id=token.session_id
        WHERE session.user_id=$1 ORDER BY token.created_at,token.id`,
      [account.userId]
    )).rows;
    const refreshInserts = (await pool.query(
      `SELECT token_id,session_id,transaction_id
         FROM pr122_refresh_insert_audit
        WHERE user_id=$1 ORDER BY sequence`,
      [account.userId]
    )).rows;
    const passwordUpdates = (await pool.query(
      `SELECT old_hash,new_hash,transaction_id
         FROM pr122_password_update_audit
        WHERE user_id=$1 ORDER BY sequence`,
      [account.userId]
    )).rows;
    return { ...authority, sessions, tokens, refreshInserts, passwordUpdates };
  }

  async function refreshRequest(account) {
    return request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${credentials.REFRESH_COOKIE}=${encodeURIComponent(account.refresh)}; ` +
        `${credentials.CSRF_COOKIE}=${encodeURIComponent(account.csrf)}`)
      .set('X-CSRF-Token', account.csrf)
      .send({});
  }

  async function resetRequest(account) {
    return request(app)
      .post('/api/auth/reset-password')
      .set('X-Forwarded-For', source())
      .send({ token: account.rawReset, password: account.newPassword });
  }

  async function assertLaterPasswords(account) {
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
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Task-owned PostgreSQL 18.4 identity is required for reset/refresh race safety');
    }
    for (const name of PROVIDER_ENVIRONMENT) expect(process.env[name]).toBeUndefined();
    allocation = await createSuiteDatabase('m20 phase7 refresh reset race');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
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
    const accountService = require('../../src/accounts/service');
    ({ hashPassword, verifyPassword } = accountService);
    credentials = require('../../src/auth/credentials');
    repository = new AccountRepository(pool);
    operationErrors = [];
    observedRepository = new Proxy(repository, {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        if (!['rotateRefresh', 'resetPasswordWithToken'].includes(property)) return value.bind(target);
        return async (...args) => {
          try {
            return await value.apply(target, args);
          } catch (error) {
            operationErrors.push({ operation: property, code: error && error.code, message: error && error.message });
            throw error;
          }
        };
      },
    });
    service = new accountService.AccountService(observedRepository, { sleep: async () => {} });
    const { createAuthRouter } = require('../../src/routes/auth');
    app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.locals.accountRepository = repository;
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({ service }));
    priorFetch = global.fetch;
    providerCalls = 0;
    global.fetch = async () => {
      providerCalls += 1;
      throw new Error('Provider network access is forbidden in reset/refresh race tests');
    };
    await pool.query(`
      CREATE TABLE pr122_refresh_blocks(session_id UUID PRIMARY KEY,lock_key BIGINT NOT NULL);
      CREATE TABLE pr122_password_blocks(user_id UUID PRIMARY KEY,lock_key BIGINT NOT NULL);
      CREATE TABLE pr122_refresh_insert_audit(
        sequence BIGSERIAL PRIMARY KEY,token_id UUID NOT NULL,session_id UUID NOT NULL,
        user_id UUID NOT NULL,transaction_id BIGINT NOT NULL
      );
      CREATE TABLE pr122_password_update_audit(
        sequence BIGSERIAL PRIMARY KEY,user_id UUID NOT NULL,old_hash TEXT NOT NULL,
        new_hash TEXT NOT NULL,transaction_id BIGINT NOT NULL
      );
      CREATE FUNCTION pr122_block_refresh_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE selected_lock BIGINT;
      BEGIN
        SELECT lock_key INTO selected_lock FROM pr122_refresh_blocks WHERE session_id=NEW.session_id;
        IF FOUND THEN PERFORM pg_advisory_xact_lock(selected_lock); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_block_refresh_insert BEFORE INSERT ON auth_refresh_tokens
        FOR EACH ROW EXECUTE FUNCTION pr122_block_refresh_insert();
      CREATE FUNCTION pr122_block_password_update() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE selected_lock BIGINT;
      BEGIN
        SELECT lock_key INTO selected_lock FROM pr122_password_blocks WHERE user_id=NEW.id;
        IF FOUND THEN PERFORM pg_advisory_xact_lock(selected_lock); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_block_password_update BEFORE UPDATE OF password_hash ON users
        FOR EACH ROW EXECUTE FUNCTION pr122_block_password_update();
      CREATE FUNCTION pr122_audit_refresh_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_refresh_insert_audit(token_id,session_id,user_id,transaction_id)
        SELECT NEW.id,NEW.session_id,session.user_id,txid_current()
          FROM auth_sessions session WHERE session.id=NEW.session_id;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_refresh_insert AFTER INSERT ON auth_refresh_tokens
        FOR EACH ROW EXECUTE FUNCTION pr122_audit_refresh_insert();
      CREATE FUNCTION pr122_audit_password_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_password_update_audit(user_id,old_hash,new_hash,transaction_id)
        VALUES(NEW.id,OLD.password_hash,NEW.password_hash,txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_password_update AFTER UPDATE OF password_hash ON users
        FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
        EXECUTE FUNCTION pr122_audit_password_update();
    `);
  }, 60000);

  beforeEach(async () => {
    providerCalls = 0;
    operationErrors.length = 0;
    await pool.query('DELETE FROM pr122_refresh_blocks');
    await pool.query('DELETE FROM pr122_password_blocks');
  });

  afterAll(async () => {
    global.fetch = priorFetch;
    if (pool) {
      await pool.query(`
        DROP TRIGGER IF EXISTS pr122_audit_password_update ON users;
        DROP FUNCTION IF EXISTS pr122_audit_password_update();
        DROP TRIGGER IF EXISTS pr122_audit_refresh_insert ON auth_refresh_tokens;
        DROP FUNCTION IF EXISTS pr122_audit_refresh_insert();
        DROP TRIGGER IF EXISTS pr122_block_password_update ON users;
        DROP FUNCTION IF EXISTS pr122_block_password_update();
        DROP TRIGGER IF EXISTS pr122_block_refresh_insert ON auth_refresh_tokens;
        DROP FUNCTION IF EXISTS pr122_block_refresh_insert();
        DROP TABLE IF EXISTS pr122_password_update_audit;
        DROP TABLE IF EXISTS pr122_refresh_insert_audit;
        DROP TABLE IF EXISTS pr122_password_blocks;
        DROP TABLE IF EXISTS pr122_refresh_blocks;
      `);
    }
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  }, 60000);

  test('both legal orders serialize refresh and reset without a recovery deadlock', async () => {
    const refreshFirst = await seedAccount(`refresh-first-${crypto.randomUUID()}`);
    const refreshFirstState = await durableState(refreshFirst);
    const refreshFirstSessionId = refreshFirstState.sessions[0].id;
    const refreshLock = 122301;
    await pool.query('INSERT INTO pr122_refresh_blocks(session_id,lock_key) VALUES($1,$2)', [
      refreshFirstSessionId, refreshLock,
    ]);
    const refreshBlocker = await pool.connect();
    await refreshBlocker.query('SELECT pg_advisory_lock($1)', [refreshLock]);
    try {
      const refreshPromise = refreshRequest(refreshFirst).then(value => value);
      expect((await waitForLock(['INSERT INTO public.auth_refresh_tokens'])).wait_event).toBe('advisory');
      const resetPromise = resetRequest(refreshFirst).then(value => value);
      expect(['transactionid', 'tuple']).toContain(
        (await waitForLock(['FROM public.account_action_tokens t'])).wait_event
      );
      expect((await refreshBlocker.query('SELECT pg_advisory_unlock($1) AS unlocked', [refreshLock]))
        .rows[0].unlocked).toBe(true);
      const [refreshed, reset] = await Promise.all([refreshPromise, resetPromise]);
      expect(refreshed.status).toBe(200);
      expect(reset.status).toBe(200);
      const state = await durableState(refreshFirst);
      expect((await verifyPassword(refreshFirst.oldPassword, state.password_hash)).valid).toBe(false);
      expect((await verifyPassword(refreshFirst.newPassword, state.password_hash)).valid).toBe(true);
      expect(state.consumed_at).not.toBeNull();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].status).toBe('revoked');
      expect(state.sessions[0].revoke_reason).toBe('password_reset');
      expect(state.tokens.map(token => [token.status, token.revoke_reason])).toEqual([
        ['rotated', null], ['revoked', 'password_reset'],
      ]);
      expect(state.refreshInserts).toHaveLength(2);
      expect(state.passwordUpdates).toHaveLength(1);
      expect(Number(state.refreshInserts[1].transaction_id))
        .toBeLessThan(Number(state.passwordUpdates[0].transaction_id));
      const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(refreshed));
      expect(me.status).toBe(401);
      expect(publicBody(me)).toEqual({ error: 'Session is no longer active', code: 'session_inactive' });
      await assertLaterPasswords(refreshFirst);
    } finally {
      await refreshBlocker.query('SELECT pg_advisory_unlock($1)', [refreshLock]);
      refreshBlocker.release();
    }

    const resetFirst = await seedAccount(`reset-first-${crypto.randomUUID()}`);
    const resetLock = 122302;
    await pool.query('INSERT INTO pr122_password_blocks(user_id,lock_key) VALUES($1,$2)', [
      resetFirst.userId, resetLock,
    ]);
    const resetBlocker = await pool.connect();
    await resetBlocker.query('SELECT pg_advisory_lock($1)', [resetLock]);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resetPromise = resetRequest(resetFirst).then(value => value);
      expect((await waitForLock(['UPDATE public.users SET password_hash'])).wait_event).toBe('advisory');
      const staleRefreshPromise = refreshRequest(resetFirst).then(value => value);
      expect(['transactionid', 'tuple']).toContain((await waitForLock([
        'FOR UPDATE OF token, session, u, membership',
        'FOR UPDATE OF u, membership',
      ])).wait_event);
      expect((await resetBlocker.query('SELECT pg_advisory_unlock($1) AS unlocked', [resetLock]))
        .rows[0].unlocked).toBe(true);
      const [reset, staleRefresh] = await Promise.all([resetPromise, staleRefreshPromise]);
      expect(reset.status).toBe(200);
      expect(staleRefresh.status).toBe(401);
      expect(publicBody(staleRefresh)).toEqual({
        error: 'Refresh credential is invalid or expired', code: 'refresh_replay',
      });
      expect(staleRefresh.headers['set-cookie']).toHaveLength(3);
      expect(staleRefresh.headers['set-cookie'].every(value => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(value)))
        .toBe(true);
      expect(operationErrors.some(error => error.code === '40P01')).toBe(false);
      expect(errorLog).not.toHaveBeenCalled();
      const state = await durableState(resetFirst);
      expect((await verifyPassword(resetFirst.oldPassword, state.password_hash)).valid).toBe(false);
      expect((await verifyPassword(resetFirst.newPassword, state.password_hash)).valid).toBe(true);
      expect(state.consumed_at).not.toBeNull();
      expect(state.sessions).toHaveLength(1);
      expect([state.sessions[0].status, state.sessions[0].revoke_reason])
        .toEqual(['revoked', 'password_reset']);
      expect(state.tokens.map(token => [token.status, token.revoke_reason]))
        .toEqual([['revoked', 'password_reset']]);
      const me = await request(app).get('/api/auth/me').set('Cookie', cookieHeader(resetFirst.login));
      expect(me.status).toBe(401);
      expect(publicBody(me)).toEqual({ error: 'Session is no longer active', code: 'session_inactive' });
      await assertLaterPasswords(resetFirst);
    } finally {
      errorLog.mockRestore();
      await resetBlocker.query('SELECT pg_advisory_unlock($1)', [resetLock]);
      resetBlocker.release();
    }
    expect(providerCalls).toBe(0);
  }, 120000);

  test('ordinary ungated reset/refresh races never abort recovery', async () => {
    const outcomes = [];
    for (const order of ['reset_first', 'refresh_first']) {
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const account = await seedAccount(`${order}-${iteration}-${crypto.randomUUID()}`);
        const reset = () => repository.resetPasswordWithToken({
          tokenHash: credentials.hashToken(account.rawReset), passwordHash: account.newHash,
        });
        const refresh = () => service.refresh(account.refresh, account.csrf, account.csrf);
        const first = order === 'reset_first' ? reset() : refresh();
        await new Promise(resolve => setImmediate(resolve));
        const second = order === 'reset_first' ? refresh() : reset();
        const settled = await Promise.allSettled([first, second]);
        const resetResult = order === 'reset_first' ? settled[0] : settled[1];
        const refreshResult = order === 'reset_first' ? settled[1] : settled[0];
        expect(resetResult.status).toBe('fulfilled');
        const state = await durableState(account);
        expect(state.password_hash).toBe(account.newHash);
        expect(state.consumed_at).not.toBeNull();
        expect(state.sessions.filter(session => session.status === 'active')).toEqual([]);
        expect(state.tokens.filter(token => token.status === 'active')).toEqual([]);
        if (refreshResult.status === 'rejected') {
          expect(['csrf_invalid', 'refresh_invalid', 'refresh_replay'])
            .toContain(refreshResult.reason && refreshResult.reason.code);
        }
        outcomes.push({ order, reset: resetResult.status, refresh: refreshResult.status });
      }
    }
    expect(outcomes).toHaveLength(24);
    expect(operationErrors.some(error => error.code === '40P01')).toBe(false);
    expect(providerCalls).toBe(0);
  }, 180000);

  test('refresh insertion failure rolls back and the exact original credential remains retryable', async () => {
    const account = await seedAccount(`rollback-${crypto.randomUUID()}`);
    const before = await durableState(account);
    await pool.query(`
      CREATE FUNCTION pr122_fail_refresh_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected refresh insertion rollback'; END $$;
      CREATE TRIGGER pr122_fail_refresh_insert BEFORE INSERT ON auth_refresh_tokens
        FOR EACH ROW EXECUTE FUNCTION pr122_fail_refresh_insert();
    `);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    let failed;
    try {
      failed = await refreshRequest(account);
      expect(failed.status).toBe(500);
      expect(publicBody(failed)).toEqual({
        error: 'Authentication request failed', code: 'auth_request_failed',
      });
      expect(failed.headers['set-cookie']).toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith('[Auth] Request failed:', {
        requestId: 'unavailable', event: 'refresh_failed',
      });
    } finally {
      errorLog.mockRestore();
      await pool.query('DROP TRIGGER IF EXISTS pr122_fail_refresh_insert ON auth_refresh_tokens');
      await pool.query('DROP FUNCTION IF EXISTS pr122_fail_refresh_insert()');
    }
    expect(await durableState(account)).toEqual(before);
    const recovered = await refreshRequest(account);
    expect(recovered.status).toBe(200);
    expect(recovered.headers['set-cookie']).toHaveLength(3);
    expect(providerCalls).toBe(0);
  }, 60000);

  test('a nonlocking route read cannot authorize after exact token/session identity changes', async () => {
    const primary = await seedAccount(`route-primary-${crypto.randomUUID()}`);
    const secondary = await seedAccount(`route-secondary-${crypto.randomUUID()}`);
    const primaryBefore = await durableState(primary);
    const primaryToken = primaryBefore.tokens[0];
    const secondarySessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO auth_sessions(
         id,user_id,organization_id,membership_id,access_expires_at,refresh_expires_at,csrf_token_hash
       ) VALUES($1,$2,$3,$4,NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '30 days',$5)`,
      [
        secondarySessionId,
        secondary.userId,
        secondary.organizationId,
        secondary.membershipId,
        credentials.hashToken(credentials.randomToken()),
      ]
    );
    const protectedSessionsBefore = (await pool.query(
      `SELECT id,status,csrf_token_hash
         FROM auth_sessions WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[primaryBefore.sessions[0].id, secondarySessionId]]
    )).rows;
    let signalRouteRead;
    let releaseRouteRead;
    const routeRead = new Promise(resolve => { signalRouteRead = resolve; });
    const routeMayContinue = new Promise(resolve => { releaseRouteRead = resolve; });
    const routedPool = {
      async connect() {
        const client = await pool.connect();
        let routed = false;
        return new Proxy(client, {
          get(target, property) {
            const value = target[property];
            if (property !== 'query') return typeof value === 'function' ? value.bind(target) : value;
            return async (...args) => {
              const result = await value.apply(target, args);
              const statement = typeof args[0] === 'string' ? args[0] : String(args[0] && args[0].text);
              if (!routed && statement.includes('FROM public.auth_refresh_tokens token') &&
                  statement.includes('WHERE token.token_hash = $1') && !statement.includes('FOR UPDATE')) {
                routed = true;
                signalRouteRead(result.rows[0]);
                await routeMayContinue;
              }
              return result;
            };
          },
        });
      },
    };
    const routedRepository = new repository.constructor(routedPool);
    const nextTokenId = crypto.randomUUID();
    const nextTokenHash = credentials.hashToken(credentials.randomToken());
    const nextCsrfHash = credentials.hashToken(credentials.randomToken());
    const rotationPromise = routedRepository.rotateRefresh({
      presentedTokenHash: credentials.hashToken(primary.refresh),
      nextTokenId,
      nextTokenHash,
      csrfTokenHash: nextCsrfHash,
      accessExpiresAt: credentials.accessExpiry(),
    });
    let timeout;
    const routed = await Promise.race([
      routeRead,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Nonlocking refresh route read timed out')), 10000);
      }),
    ]);
    clearTimeout(timeout);
    expect(routed).toMatchObject({
      token_id: primaryToken.id,
      session_id: primaryBefore.sessions[0].id,
      user_id: primary.userId,
      organization_id: primary.organizationId,
      membership_id: primary.membershipId,
    });
    let rotation;
    let released = false;
    try {
      await pool.query('UPDATE auth_refresh_tokens SET session_id=$2 WHERE id=$1', [
        primaryToken.id, secondarySessionId,
      ]);
      releaseRouteRead();
      released = true;
      rotation = await rotationPromise;
    } finally {
      if (!released) releaseRouteRead();
      if (!rotation) await rotationPromise.catch(() => {});
    }
    expect(rotation).toEqual({ outcome: 'invalid' });
    expect((await pool.query(
      `SELECT session_id,status,revoke_reason,replaced_by_token_id,token_hash
         FROM auth_refresh_tokens WHERE id=$1`,
      [primaryToken.id]
    )).rows[0]).toEqual({
      session_id: secondarySessionId,
      status: 'active',
      revoke_reason: null,
      replaced_by_token_id: null,
      token_hash: primaryToken.token_hash,
    });
    expect((await pool.query('SELECT count(*)::int AS count FROM auth_refresh_tokens WHERE id=$1', [
      nextTokenId,
    ])).rows[0].count).toBe(0);
    expect((await pool.query(
      'SELECT id,status,csrf_token_hash FROM auth_sessions WHERE id=ANY($1::uuid[]) ORDER BY id',
      [[primaryBefore.sessions[0].id, secondarySessionId]]
    )).rows).toEqual(protectedSessionsBefore);
    expect(providerCalls).toBe(0);
  }, 60000);

  test('CSRF, replay-family, and inactive-membership controls remain fail closed', async () => {
    const account = await seedAccount(`controls-${crypto.randomUUID()}`);
    const before = await durableState(account);
    const wrongCsrf = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${credentials.REFRESH_COOKIE}=${encodeURIComponent(account.refresh)}; ` +
        `${credentials.CSRF_COOKIE}=${encodeURIComponent(account.csrf)}`)
      .set('X-CSRF-Token', 'wrong-csrf')
      .send({});
    expect(wrongCsrf.status).toBe(403);
    expect(publicBody(wrongCsrf)).toEqual({ error: 'CSRF validation failed', code: 'csrf_invalid' });
    expect(wrongCsrf.headers['set-cookie']).toBeUndefined();
    expect(await durableState(account)).toEqual(before);

    const rotated = await refreshRequest(account);
    expect(rotated.status).toBe(200);
    const replay = await refreshRequest(account);
    expect(replay.status).toBe(401);
    expect(publicBody(replay)).toEqual({
      error: 'Refresh credential is invalid or expired', code: 'refresh_replay',
    });
    const replayState = await durableState(account);
    expect(replayState.sessions[0].status).toBe('revoked');
    expect(replayState.sessions[0].revoke_reason).toBe('refresh_replay');
    expect(replayState.tokens.every(token => token.status !== 'active')).toBe(true);

    const inactive = await seedAccount(`inactive-${crypto.randomUUID()}`);
    await pool.query("UPDATE organization_memberships SET status='suspended' WHERE id=$1", [
      inactive.membershipId,
    ]);
    const inactiveResponse = await refreshRequest(inactive);
    expect(inactiveResponse.status).toBe(401);
    expect(publicBody(inactiveResponse)).toEqual({
      error: 'Refresh credential is invalid or expired', code: 'refresh_invalid',
    });
    const inactiveState = await durableState(inactive);
    expect(inactiveState.sessions[0].status).toBe('revoked');
    expect(inactiveState.sessions[0].revoke_reason).toBe('account_inactive');
    expect(inactiveState.tokens[0].status).toBe('revoked');
    expect(inactiveState.tokens[0].revoke_reason).toBe('account_inactive');
    expect(providerCalls).toBe(0);
  }, 60000);
});
