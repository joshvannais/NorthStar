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

describe('Mission 20 Phase 7 OAuth-state/password-reset transaction authority', () => {
  let allocation;
  let db;
  let pool;
  let repository;
  let oauth;
  let credentials;
  let app;
  let newPasswordHash;
  let priorDatabaseUrl;
  let priorFetch;
  let providerCalls;
  const operationErrors = [];
  let lockSequence = 122500;

  async function waitForLock(fragments, waitEvent) {
    const deadline = Date.now() + 20000;
    do {
      const activity = (await pool.query(
        `SELECT pid,wait_event_type,wait_event,query
           FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>pg_backend_pid()
            AND state='active' AND wait_event_type='Lock'`
      )).rows;
      const waiting = activity.find(row =>
        (!waitEvent || row.wait_event === waitEvent) &&
        fragments.some(fragment => row.query.includes(fragment))
      );
      if (waiting) return waiting;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for PostgreSQL lock: ${fragments.join(' | ')}`);
  }

  async function withObserved(operation, work) {
    try {
      return await work();
    } catch (error) {
      operationErrors.push({
        operation,
        code: error && error.code,
        causeCode: error && error.cause && error.cause.code,
        message: error && error.message,
      });
      throw error;
    }
  }

  async function seedAccount(label) {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const refreshTokenId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const resetTokenId = crypto.randomUUID();
    const rawReset = crypto.randomBytes(32).toString('base64url');
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const oldPasswordHash = '$2b$12$Fe2eC306EHU7fEolv4fqPuCddsTvclr8ksAQrPyFPtUgNQhM/BgTW';
    await pool.query(
      `INSERT INTO organizations(id,name,owner_name,email,phone)
       VALUES($1,$2,'OAuth Reset Owner',$3,'')`,
      [organizationId, `OAuth reset ${label}`, email]
    );
    await pool.query(
      `INSERT INTO users
        (id,organization_id,name,email,email_normalized,password_hash,phone,role,status)
       VALUES($1,$2,'OAuth Reset Owner',$3,$3,$4,'','owner','active')`,
      [userId, organizationId, email, oldPasswordHash]
    );
    await pool.query(
      `INSERT INTO organization_memberships(id,organization_id,user_id,role,status)
       VALUES($1,$2,$3,'owner','active')`,
      [membershipId, organizationId, userId]
    );
    await pool.query(
      `INSERT INTO canonical_business_profiles(
         id,organization_id,version_number,version_label,raw_profile,normalized_profile,
         normalized_profile_hash,is_active,created_by
       ) VALUES($1,$2,1,$3,'{}'::jsonb,'{}'::jsonb,$4,TRUE,$5)`,
      [
        profileId,
        organizationId,
        `oauth-reset-${label}`,
        crypto.createHash('sha256').update('{}').digest('hex'),
        userId,
      ]
    );
    await pool.query(
      `INSERT INTO organization_onboarding(
         organization_id,status,active_business_profile_id,completed_at
       ) VALUES($1,'complete',$2,NOW())`,
      [organizationId, profileId]
    );
    await pool.query(
      `INSERT INTO auth_sessions(
         id,user_id,organization_id,membership_id,access_expires_at,refresh_expires_at,csrf_token_hash
       ) VALUES($1,$2,$3,$4,NOW()+INTERVAL '15 minutes',NOW()+INTERVAL '30 days',$5)`,
      [sessionId, userId, organizationId, membershipId, credentials.hashToken('csrf')]
    );
    await pool.query(
      `INSERT INTO auth_refresh_tokens(id,session_id,family_id,token_hash,expires_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '30 days')`,
      [refreshTokenId, sessionId, familyId, credentials.hashToken(crypto.randomUUID())]
    );
    await pool.query(
      `INSERT INTO account_action_tokens(
         id,user_id,organization_id,purpose,token_hash,expires_at
       ) VALUES($1,$2,$3,'password_reset',$4,NOW()+INTERVAL '30 minutes')`,
      [resetTokenId, userId, organizationId, credentials.hashToken(rawReset)]
    );
    return {
      organizationId,
      userId,
      membershipId,
      sessionId,
      resetTokenId,
      rawReset,
      oldPasswordHash,
      accessCookie: `${credentials.ACCESS_COOKIE}=${encodeURIComponent(
        credentials.signAccess(userId, sessionId)
      )}`,
    };
  }

  async function prepareOAuth(account, operation) {
    const binding = {
      provider: 'jobber',
      organizationId: account.organizationId,
      userId: account.userId,
      sessionId: account.sessionId,
    };
    if (operation === 'issue') return { binding };
    const rawState = await oauth.issueAuthorizationState(binding);
    expect(rawState).toHaveLength(oauth.STATE_LENGTH);
    const state = (await pool.query(
      `SELECT id,state_hash,status FROM oauth_authorization_states
        WHERE auth_session_id=$1 ORDER BY id DESC LIMIT 1`,
      [account.sessionId]
    )).rows[0];
    return { binding: { ...binding, rawState }, stateId: state.id };
  }

  function oauthOperation(operation, prepared) {
    return operation === 'issue'
      ? oauth.issueAuthorizationState(prepared.binding)
      : oauth.consumeAuthorizationState(prepared.binding);
  }

  function resetOperation(account) {
    return repository.resetPasswordWithToken({
      tokenHash: credentials.hashToken(account.rawReset),
      passwordHash: newPasswordHash,
    });
  }

  async function durableState(account) {
    const authority = (await pool.query(
      `SELECT u.password_hash,u.xmin::text::bigint AS user_xid,
              reset.consumed_at,reset.xmin::text::bigint AS reset_xid
         FROM users u JOIN account_action_tokens reset ON reset.user_id=u.id
        WHERE u.id=$1 AND reset.id=$2`,
      [account.userId, account.resetTokenId]
    )).rows[0];
    const sessions = (await pool.query(
      `SELECT id,status,revoke_reason,xmin::text::bigint AS row_xid
         FROM auth_sessions WHERE user_id=$1 ORDER BY id`,
      [account.userId]
    )).rows;
    const refreshTokens = (await pool.query(
      `SELECT token.id,token.status,token.revoke_reason,token.xmin::text::bigint AS row_xid
         FROM auth_refresh_tokens token
         JOIN auth_sessions session ON session.id=token.session_id
        WHERE session.user_id=$1 ORDER BY token.id`,
      [account.userId]
    )).rows;
    const states = (await pool.query(
      `SELECT id,status,consumed_at,xmin::text::bigint AS row_xid
         FROM oauth_authorization_states WHERE auth_session_id=$1 ORDER BY id`,
      [account.sessionId]
    )).rows;
    const audit = (await pool.query(
      `SELECT operation,target_id,transaction_id
         FROM pr122_oauth_reset_audit WHERE user_id=$1 ORDER BY sequence`,
      [account.userId]
    )).rows;
    return { ...authority, sessions, refreshTokens, states, audit };
  }

  async function assertResetAuthority(account, state) {
    expect(state.password_hash).toBe(newPasswordHash);
    expect(state.consumed_at).not.toBeNull();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({ status: 'revoked', revoke_reason: 'password_reset' });
    expect(state.refreshTokens).toHaveLength(1);
    expect(state.refreshTokens[0]).toMatchObject({ status: 'revoked', revoke_reason: 'password_reset' });
    const me = await request(app).get('/api/auth/me').set('Cookie', account.accessCookie);
    expect(me.status).toBe(401);
    expect(publicBody(me)).toEqual({ error: 'Session is no longer active', code: 'session_inactive' });
  }

  async function resetFirstRace(operation, label) {
    const account = await seedAccount(`reset-first-${operation}-${label}`);
    const prepared = await prepareOAuth(account, operation);
    const lockKey = ++lockSequence;
    await pool.query('INSERT INTO pr122_password_blocks(user_id,lock_key) VALUES($1,$2)', [
      account.userId, lockKey,
    ]);
    const blocker = await pool.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [lockKey]);
    let unlocked = false;
    try {
      const resetPromise = withObserved('reset', () => resetOperation(account));
      await waitForLock(['UPDATE users SET password_hash'], 'advisory');
      const oauthPromise = withObserved(operation, () => oauthOperation(operation, prepared));
      await waitForLock([
        'FROM auth_sessions session',
        'FROM oauth_authorization_states state',
        'FROM users',
      ]);
      unlocked = (await blocker.query('SELECT pg_advisory_unlock($1) AS value', [lockKey])).rows[0].value;
      const [resetResult, oauthResult] = await Promise.allSettled([resetPromise, oauthPromise]);
      return { account, prepared, resetResult, oauthResult, state: await durableState(account) };
    } finally {
      if (!unlocked) await blocker.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      blocker.release();
    }
  }

  async function oauthFirstRace(operation, label) {
    const account = await seedAccount(`oauth-first-${operation}-${label}`);
    const prepared = await prepareOAuth(account, operation);
    const lockKey = ++lockSequence;
    await pool.query(
      `INSERT INTO pr122_oauth_blocks(operation,target_id,lock_key) VALUES($1,$2,$3)`,
      [operation, operation === 'issue' ? account.sessionId : prepared.stateId, lockKey]
    );
    const blocker = await pool.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [lockKey]);
    let unlocked = false;
    try {
      const oauthPromise = withObserved(operation, () => oauthOperation(operation, prepared));
      await waitForLock([
        'INSERT INTO oauth_authorization_states',
        'UPDATE oauth_authorization_states',
      ], 'advisory');
      const resetPromise = withObserved('reset', () => resetOperation(account));
      await waitForLock(['FROM account_action_tokens t']);
      unlocked = (await blocker.query('SELECT pg_advisory_unlock($1) AS value', [lockKey])).rows[0].value;
      const [oauthResult, resetResult] = await Promise.allSettled([oauthPromise, resetPromise]);
      return { account, prepared, resetResult, oauthResult, state: await durableState(account) };
    } finally {
      if (!unlocked) await blocker.query('SELECT pg_advisory_unlock($1)', [lockKey]);
      blocker.release();
    }
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Task-owned PostgreSQL 18.4 identity is required for OAuth/reset race safety');
    }
    for (const name of PROVIDER_ENVIRONMENT) expect(process.env[name]).toBeUndefined();
    allocation = await createSuiteDatabase('m20 phase7 oauth reset race');
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
    const { AccountService, hashPassword } = require('../../src/accounts/service');
    credentials = require('../../src/auth/credentials');
    repository = new AccountRepository(pool);
    oauth = require('../../src/integrations/oauthAuthorizationState');
    newPasswordHash = await hashPassword('OAuth-reset-new-password!');
    const service = new AccountService(repository, { sleep: async () => {} });
    const { createAuthRouter } = require('../../src/routes/auth');
    app = express();
    app.locals.accountRepository = repository;
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({ service }));
    priorFetch = global.fetch;
    providerCalls = 0;
    global.fetch = async () => {
      providerCalls += 1;
      throw new Error('Provider network access is forbidden in OAuth/reset race tests');
    };
    await pool.query(`
      CREATE TABLE pr122_password_blocks(user_id UUID PRIMARY KEY,lock_key BIGINT NOT NULL);
      CREATE TABLE pr122_oauth_blocks(
        operation TEXT NOT NULL,target_id UUID NOT NULL,lock_key BIGINT NOT NULL,
        PRIMARY KEY(operation,target_id)
      );
      CREATE TABLE pr122_oauth_reset_audit(
        sequence BIGSERIAL PRIMARY KEY,operation TEXT NOT NULL,user_id UUID NOT NULL,
        target_id UUID NOT NULL,transaction_id BIGINT NOT NULL
      );
      CREATE FUNCTION pr122_block_password_update() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE selected_lock BIGINT;
      BEGIN
        SELECT lock_key INTO selected_lock FROM pr122_password_blocks WHERE user_id=NEW.id;
        IF FOUND THEN PERFORM pg_advisory_xact_lock(selected_lock); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_block_password_update BEFORE UPDATE OF password_hash ON users
        FOR EACH ROW EXECUTE FUNCTION pr122_block_password_update();
      CREATE FUNCTION pr122_block_oauth_issue() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE selected_lock BIGINT;
      BEGIN
        SELECT lock_key INTO selected_lock FROM pr122_oauth_blocks
         WHERE operation='issue' AND target_id=NEW.auth_session_id;
        IF FOUND THEN PERFORM pg_advisory_xact_lock(selected_lock); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_block_oauth_issue BEFORE INSERT ON oauth_authorization_states
        FOR EACH ROW EXECUTE FUNCTION pr122_block_oauth_issue();
      CREATE FUNCTION pr122_block_oauth_consume() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE selected_lock BIGINT;
      BEGIN
        SELECT lock_key INTO selected_lock FROM pr122_oauth_blocks
         WHERE operation='consume' AND target_id=OLD.id;
        IF FOUND THEN PERFORM pg_advisory_xact_lock(selected_lock); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_block_oauth_consume BEFORE UPDATE OF status ON oauth_authorization_states
        FOR EACH ROW EXECUTE FUNCTION pr122_block_oauth_consume();
      CREATE FUNCTION pr122_audit_password_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_oauth_reset_audit(operation,user_id,target_id,transaction_id)
        VALUES('reset',NEW.id,NEW.id,txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_password_update AFTER UPDATE OF password_hash ON users
        FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash)
        EXECUTE FUNCTION pr122_audit_password_update();
      CREATE FUNCTION pr122_audit_oauth_issue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_oauth_reset_audit(operation,user_id,target_id,transaction_id)
        VALUES('issue',NEW.user_id,NEW.id,txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_oauth_issue AFTER INSERT ON oauth_authorization_states
        FOR EACH ROW EXECUTE FUNCTION pr122_audit_oauth_issue();
      CREATE FUNCTION pr122_audit_oauth_consume() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO pr122_oauth_reset_audit(operation,user_id,target_id,transaction_id)
        VALUES('consume',NEW.user_id,NEW.id,txid_current());
        RETURN NEW;
      END $$;
      CREATE TRIGGER pr122_audit_oauth_consume AFTER UPDATE OF status ON oauth_authorization_states
        FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION pr122_audit_oauth_consume();
    `);
  }, 60000);

  beforeEach(async () => {
    providerCalls = 0;
    operationErrors.length = 0;
    await pool.query('DELETE FROM pr122_password_blocks');
    await pool.query('DELETE FROM pr122_oauth_blocks');
  });

  afterAll(async () => {
    global.fetch = priorFetch;
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  }, 60000);

  test.each(['issue', 'consume'])(
    'both legal %s/reset orders serialize without a deadlock or stale authority',
    async operation => {
      const races = [];
      for (let repetition = 0; repetition < 3; repetition += 1) {
        const resetFirst = await resetFirstRace(operation, repetition);
        const oauthFirst = await oauthFirstRace(operation, repetition);
        races.push({ resetFirst, oauthFirst });
      }
      expect(operationErrors.filter(error =>
        error.code === '40P01' || error.causeCode === '40P01'
      )).toEqual([]);
      for (const { resetFirst, oauthFirst } of races) {
        expect(resetFirst.resetResult.status).toBe('fulfilled');
        expect(resetFirst.oauthResult).toEqual({ status: 'fulfilled', value: null });
        await assertResetAuthority(resetFirst.account, resetFirst.state);
        expect(resetFirst.state.audit.map(row => row.operation)).toEqual(
          operation === 'consume' ? ['issue', 'reset'] : ['reset']
        );
        if (operation === 'consume') expect(resetFirst.state.states[0].status).toBe('pending');
        else expect(resetFirst.state.states).toEqual([]);
        expect(oauthFirst.oauthResult.status).toBe('fulfilled');
        expect(oauthFirst.oauthResult.value).not.toBeNull();
        expect(oauthFirst.resetResult.status).toBe('fulfilled');
        await assertResetAuthority(oauthFirst.account, oauthFirst.state);
        expect(oauthFirst.state.audit.map(row => row.operation)).toEqual(
          operation === 'consume' ? ['issue', 'consume', 'reset'] : ['issue', 'reset']
        );
        const oauthAudit = oauthFirst.state.audit.filter(row => row.operation === operation).at(-1);
        const resetAudit = oauthFirst.state.audit.find(row => row.operation === 'reset');
        expect(Number(oauthAudit.transaction_id)).toBeLessThan(Number(resetAudit.transaction_id));
        expect(oauthFirst.state.states).toHaveLength(1);
        expect(oauthFirst.state.states[0].status).toBe(operation === 'consume' ? 'consumed' : 'pending');
      }
      expect(providerCalls).toBe(0);
    },
    180000
  );

  test('ordinary ungated issue/consume/reset races preserve recovery authority', async () => {
    const outcomes = [];
    for (const operation of ['issue', 'consume']) {
      for (const order of ['reset_first', 'oauth_first']) {
        for (let repetition = 0; repetition < 4; repetition += 1) {
          const account = await seedAccount(`ordinary-${operation}-${order}-${repetition}`);
          const prepared = await prepareOAuth(account, operation);
          const reset = () => withObserved('reset', () => resetOperation(account));
          const external = () => withObserved(operation, () => oauthOperation(operation, prepared));
          const first = order === 'reset_first' ? reset() : external();
          await new Promise(resolve => setImmediate(resolve));
          const second = order === 'reset_first' ? external() : reset();
          const settled = await Promise.allSettled([first, second]);
          const resetResult = order === 'reset_first' ? settled[0] : settled[1];
          const state = await durableState(account);
          outcomes.push({ account, operation, order, resetResult, state,
            settled: settled.map(result => result.status) });
        }
      }
    }
    expect(outcomes).toHaveLength(16);
    expect(operationErrors.filter(error =>
      error.code === '40P01' || error.causeCode === '40P01'
    )).toEqual([]);
    for (const outcome of outcomes) {
      expect(outcome.resetResult.status).toBe('fulfilled');
      await assertResetAuthority(outcome.account, outcome.state);
    }
    expect(providerCalls).toBe(0);
  }, 180000);

  test('legitimate OAuth single-use and reset controls remain intact', async () => {
    const account = await seedAccount('legitimate-controls');
    const binding = {
      provider: 'jobber',
      organizationId: account.organizationId,
      userId: account.userId,
      sessionId: account.sessionId,
    };
    const rawState = await oauth.issueAuthorizationState(binding);
    expect(rawState).toHaveLength(oauth.STATE_LENGTH);
    await expect(oauth.consumeAuthorizationState({ ...binding, rawState })).resolves.toEqual({
      organizationId: account.organizationId,
      userId: account.userId,
      sessionId: account.sessionId,
    });
    await expect(oauth.consumeAuthorizationState({ ...binding, rawState })).resolves.toBeNull();
    await expect(resetOperation(account)).resolves.toEqual({
      userId: account.userId,
      organizationId: account.organizationId,
    });
    await assertResetAuthority(account, await durableState(account));
    expect(operationErrors).toEqual([]);
    expect(providerCalls).toBe(0);
  }, 60000);
});
