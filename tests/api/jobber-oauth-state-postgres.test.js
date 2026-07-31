'use strict';

const crypto = require('crypto');
const https = require('https');
const path = require('path');
const { fork } = require('child_process');
const { EventEmitter } = require('events');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

function responseCookies(response) {
  const values = {};
  for (const header of response.headers['set-cookie'] || []) {
    const pair = header.split(';')[0];
    const separator = pair.indexOf('=');
    values[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
  }
  return values;
}

function cookieHeader(values) {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

function identifierRepresentations(value) {
  const text = String(value);
  return new Set([
    text,
    encodeURIComponent(text),
    Buffer.from(text, 'utf8').toString('base64'),
    Buffer.from(text, 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: text }), 'utf8').toString('base64url'),
  ]);
}

function startCallbackWorker(connectionString, secret, oauthEnabled = true, additionalEnvironment = {}) {
  const child = fork(path.resolve(__dirname, '../helpers/jobber-oauth-callback-worker.js'), [], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      AUTH_ACCESS_SECRET: secret,
      JOBBER_CLIENT_ID: 'disposable-jobber-client',
      JOBBER_CLIENT_SECRET: 'disposable-jobber-secret',
      JOBBER_TEST_CONNECTION_CAPABILITY: oauthEnabled
        ? 'intercepted-canonical-postgresql'
        : 'absent',
      ...additionalEnvironment,
    },
    silent: true,
  });
  let stderr = '';
  let readyResolve;
  let readyReject;
  let resultResolve;
  let resultReject;
  let resultSettled = false;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('message', message => {
    if (message.type === 'ready') {
      readyResolve();
    } else if (message.type === 'result') {
      resultSettled = true;
      resultResolve(message);
    } else if (message.type === 'error') {
      resultSettled = true;
      const error = new Error(`${message.code}\n${stderr}`);
      readyReject(error);
      resultReject(error);
    }
  });
  child.on('error', error => {
    readyReject(error);
    resultReject(error);
  });
  child.on('exit', code => {
    if (!resultSettled) {
      const error = new Error(`Jobber callback worker exited before result: ${code}\n${stderr}`);
      readyReject(error);
      resultReject(error);
    }
  });
  return {
    ready,
    run(message) {
      child.send(message);
      return result;
    },
  };
}

describe('mounted opaque Jobber OAuth authorization state on required PostgreSQL 18', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let productionApp;
  let jobber;
  let stateAuthority;
  let realExchangeCode;
  let realSaveTokens;
  let authUrlSpy;
  let exchangeSpy;
  let saveSpy;
  let legacySaveSpy;
  let legacyDisconnectSpy;
  let statusSpy;
  let disconnectSpy;
  let issueStateSpy;
  let consumeStateSpy;
  let httpsSpy;
  let fetchSpy;
  const originals = {};

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for Jobber OAuth state');
    }
    allocation = await createSuiteDatabase('jobber-oauth-state');
    for (const key of [
      'DATABASE_URL',
      'AUTH_ACCESS_SECRET',
      'ACCOUNT_SIGNUP_ENABLED',
      'ACCOUNT_VERIFICATION_DELIVERY_READY',
      'JOBBER_CLIENT_ID',
      'JOBBER_CLIENT_SECRET',
      'JOBBER_INTEGRATION_ENABLED',
      'JOBBER_OAUTH_ENABLED',
      'JOBBER_TOKEN_PERSISTENCE_ENABLED',
    ]) originals[key] = process.env[key];
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'false';
    process.env.JOBBER_CLIENT_ID = 'disposable-jobber-client';
    process.env.JOBBER_CLIENT_SECRET = 'disposable-jobber-secret';

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    jobber = require('../../src/integrations/jobber');
    stateAuthority = require('../../src/integrations/oauthAuthorizationState');
    realExchangeCode = jobber.exchangeCode.bind(jobber);
    realSaveTokens = jobber.saveTokens.bind(jobber);
    authUrlSpy = jest.spyOn(jobber, 'getAuthUrl');
    exchangeSpy = jest.spyOn(jobber, 'exchangeCode').mockResolvedValue({
      access_token: 'intercepted-jobber-access',
      refresh_token: 'intercepted-jobber-refresh',
      expires_in: 3600,
    });
    legacySaveSpy = jest.spyOn(jobber, 'saveTokens').mockResolvedValue(false);
    legacyDisconnectSpy = jest.spyOn(jobber, 'disconnect').mockResolvedValue(undefined);
    const connectionCapability = {
      stateAuthority,
      persistConnection: async () => true,
      readConnectionStatus: async () => ({ connected: false }),
      disconnectConnection: async () => true,
    };
    saveSpy = jest.spyOn(connectionCapability, 'persistConnection').mockResolvedValue(true);
    statusSpy = jest.spyOn(connectionCapability, 'readConnectionStatus')
      .mockResolvedValue({ connected: false });
    disconnectSpy = jest.spyOn(connectionCapability, 'disconnectConnection')
      .mockResolvedValue(true);
    httpsSpy = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('unexpected provider transmission');
    });
    if (typeof global.fetch === 'function') {
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected provider fetch'));
    }
    issueStateSpy = jest.spyOn(stateAuthority, 'issueAuthorizationState');
    consumeStateSpy = jest.spyOn(stateAuthority, 'consumeAuthorizationState');
    const { createDisposableAccountApp } = require('../helpers/account-test-app');
    app = createDisposableAccountApp({
      jobberConnectionCapability: connectionCapability,
    });
    productionApp = require('../../src/server').app;
  }, 60000);

  afterAll(async () => {
    if (fetchSpy) fetchSpy.mockRestore();
    if (httpsSpy) httpsSpy.mockRestore();
    if (statusSpy) statusSpy.mockRestore();
    if (disconnectSpy) disconnectSpy.mockRestore();
    if (saveSpy) saveSpy.mockRestore();
    if (legacyDisconnectSpy) legacyDisconnectSpy.mockRestore();
    if (legacySaveSpy) legacySaveSpy.mockRestore();
    if (consumeStateSpy) consumeStateSpy.mockRestore();
    if (issueStateSpy) issueStateSpy.mockRestore();
    if (exchangeSpy) exchangeSpy.mockRestore();
    if (authUrlSpy) authUrlSpy.mockRestore();
    if (db) await db.close();
    if (allocation) await allocation.cleanup();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }, 60000);

  beforeEach(() => {
    exchangeSpy.mockClear();
    authUrlSpy.mockClear();
    saveSpy.mockClear();
    legacyDisconnectSpy.mockClear();
    legacySaveSpy.mockClear();
    statusSpy.mockClear();
    disconnectSpy.mockClear();
    issueStateSpy.mockClear();
    consumeStateSpy.mockClear();
    httpsSpy.mockClear();
    if (fetchSpy) fetchSpy.mockClear();
  });

  async function createVerifiedOwner(label) {
    const email = `jobber-${label}-${crypto.randomUUID()}@example.test`;
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
    const signup = await request(app).post('/api/auth/signup').send({
      name: `Jobber ${label} Owner`,
      businessName: `Jobber ${label} Company`,
      phone: '8605550144',
      email,
      password: 'durable oauth password',
    });
    expect(signup.status).toBe(201);
    const cookies = responseCookies(signup);
    const cookie = cookieHeader(cookies);
    const headers = { Cookie: cookie, 'X-CSRF-Token': cookies.northstar_csrf };
    const pending = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(pending.status).toBe(200);
    expect(pending.body.account.user.status).toBe('pending_verification');
    expect(pending.body.account.onboarding.status).toBe('business_profile_required');
    const profile = await request(app).put('/api/v1/business-profile').set(headers)
      .send(canonicalFenceProfile({ companyName: `Jobber ${label} Company` }));
    expect(profile.status).toBe(200);
    const onboarded = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(onboarded.status).toBe(200);
    expect(onboarded.body.account.user.status).toBe('pending_verification');
    expect(onboarded.body.account.onboarding.status).toBe('complete');
    const authority = await pool.query(
      `SELECT users.id AS user_id,
              users.organization_id,
              membership.id AS membership_id,
              membership.role,
              session.id AS session_id
         FROM users
         JOIN organization_memberships membership
           ON membership.user_id = users.id
          AND membership.organization_id = users.organization_id
         JOIN auth_sessions session
           ON session.user_id = users.id
          AND session.organization_id = users.organization_id
          AND session.membership_id = membership.id
        WHERE users.email_normalized = $1
        ORDER BY session.created_at DESC
        LIMIT 1`,
      [email]
    );
    expect(authority.rows).toHaveLength(1);
    // TEST PROVISIONING ONLY: mounted pending signup and Business Profile
    // onboarding were proven immediately above. PR B owns verification.
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [authority.rows[0].user_id]);
    return {
      ...authority.rows[0],
      cookie,
      cookies,
      email,
      headers,
      password: 'durable oauth password',
    };
  }

  async function authorize(authority) {
    const response = await request(app).get('/api/integrations/jobber/auth')
      .set('Cookie', authority.cookie);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe('https://api.getjobber.com');
    expect(location.pathname).toBe('/api/oauth/authorize');
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();
    return { response, location, state };
  }

  async function callback(authority, state, code = 'intercepted-jobber-code') {
    return request(app).get('/api/integrations/jobber/callback')
      .set('Cookie', authority.cookie)
      .query({ code, state });
  }

  async function stateRow(authority, state) {
    const digest = crypto.createHash('sha256').update(state, 'utf8').digest('hex');
    const result = await pool.query(
      `SELECT id, provider, organization_id, user_id, auth_session_id,
              state_hash, status, created_at, expires_at, consumed_at
         FROM oauth_authorization_states
        WHERE auth_session_id = $1 AND state_hash = $2`,
      [authority.session_id, digest]
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  }

  async function stateCount(state) {
    const digest = crypto.createHash('sha256').update(state, 'utf8').digest('hex');
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE state_hash = $1',
      [digest]
    );
    return result.rows[0].count;
  }

  function expectNoTransmission() {
    expect(httpsSpy).not.toHaveBeenCalled();
    if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled();
  }

  async function sessionStateCount(authority) {
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE auth_session_id = $1',
      [authority.session_id]
    );
    return result.rows[0].count;
  }

  function expectProductionUnavailable(response) {
    expect(response.status).toBe(503);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toMatchObject({
      error: 'Jobber integration is unavailable',
      code: 'jobber_unavailable',
    });
    if (response.headers['x-request-id']) {
      expect(response.body.requestId).toEqual(expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ));
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
      expect(response.headers['x-correlation-id']).toBe(response.body.requestId);
    } else {
      expect(response.body.requestId).toBe('unavailable');
    }
  }

  function expectNoJobberCapabilityUse() {
    expect(authUrlSpy).not.toHaveBeenCalled();
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(legacySaveSpy).not.toHaveBeenCalled();
    expect(legacyDisconnectSpy).not.toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
    expect(issueStateSpy).not.toHaveBeenCalled();
    expect(consumeStateSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }

  test('migration 011 catalogs define the exact durable state contract', async () => {
    const columns = await pool.query(
      `SELECT ordinal_position,
              column_name,
              data_type,
              udt_name,
              character_maximum_length,
              is_nullable,
              column_default,
              is_identity,
              identity_generation
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'oauth_authorization_states'
        ORDER BY ordinal_position`
    );
    expect(columns.rows).toEqual([
      {
        ordinal_position: 1, column_name: 'id', data_type: 'uuid', udt_name: 'uuid',
        character_maximum_length: null, is_nullable: 'NO', column_default: 'gen_random_uuid()',
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 2, column_name: 'provider', data_type: 'character varying', udt_name: 'varchar',
        character_maximum_length: 32, is_nullable: 'NO', column_default: null,
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 3, column_name: 'organization_id', data_type: 'uuid', udt_name: 'uuid',
        character_maximum_length: null, is_nullable: 'NO', column_default: null,
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 4, column_name: 'user_id', data_type: 'uuid', udt_name: 'uuid',
        character_maximum_length: null, is_nullable: 'NO', column_default: null,
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 5, column_name: 'auth_session_id', data_type: 'uuid', udt_name: 'uuid',
        character_maximum_length: null, is_nullable: 'NO', column_default: null,
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 6, column_name: 'state_hash', data_type: 'character', udt_name: 'bpchar',
        character_maximum_length: 64, is_nullable: 'NO', column_default: null,
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 7, column_name: 'status', data_type: 'character varying', udt_name: 'varchar',
        character_maximum_length: 16, is_nullable: 'NO',
        column_default: "'pending'::character varying", is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 8, column_name: 'created_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz',
        character_maximum_length: null, is_nullable: 'NO', column_default: 'now()',
        is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 9, column_name: 'expires_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz',
        character_maximum_length: null, is_nullable: 'NO',
        column_default: "(now() + '00:10:00'::interval)", is_identity: 'NO', identity_generation: null,
      },
      {
        ordinal_position: 10, column_name: 'consumed_at', data_type: 'timestamp with time zone', udt_name: 'timestamptz',
        character_maximum_length: null, is_nullable: 'YES', column_default: null,
        is_identity: 'NO', identity_generation: null,
      },
    ]);

    const constraints = await pool.query(
      `SELECT conname, contype, pg_get_constraintdef(oid, TRUE) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.oauth_authorization_states'::regclass
        ORDER BY conname`
    );
    expect(constraints.rows.map(row => [row.conname, row.contype])).toEqual([
      ['oauth_authorization_states_auth_session_id_not_null', 'n'],
      ['oauth_authorization_states_created_at_not_null', 'n'],
      ['oauth_authorization_states_expires_at_not_null', 'n'],
      ['oauth_authorization_states_expiry_check', 'c'],
      ['oauth_authorization_states_hash_check', 'c'],
      ['oauth_authorization_states_hash_unique', 'u'],
      ['oauth_authorization_states_id_not_null', 'n'],
      ['oauth_authorization_states_organization_id_not_null', 'n'],
      ['oauth_authorization_states_pkey', 'p'],
      ['oauth_authorization_states_provider_check', 'c'],
      ['oauth_authorization_states_provider_not_null', 'n'],
      ['oauth_authorization_states_session_fk', 'f'],
      ['oauth_authorization_states_state_hash_not_null', 'n'],
      ['oauth_authorization_states_status_check', 'c'],
      ['oauth_authorization_states_status_not_null', 'n'],
      ['oauth_authorization_states_user_id_not_null', 'n'],
    ]);
    const definitions = Object.fromEntries(constraints.rows.map(row => [row.conname, row.definition]));
    expect(definitions.oauth_authorization_states_pkey).toBe('PRIMARY KEY (id)');
    expect(definitions.oauth_authorization_states_hash_unique).toBe('UNIQUE (state_hash)');
    expect(definitions.oauth_authorization_states_session_fk).toBe(
      'FOREIGN KEY (organization_id, user_id, auth_session_id) REFERENCES auth_sessions(organization_id, user_id, id) ON DELETE RESTRICT'
    );
    expect(definitions.oauth_authorization_states_expiry_check)
      .toContain("expires_at = (created_at + '00:10:00'::interval)");
    expect(definitions.oauth_authorization_states_hash_check).toContain("^[0-9a-f]{64}$");
    expect(definitions.oauth_authorization_states_provider_check).toContain("^[a-z][a-z0-9_-]{0,31}$");
    expect(definitions.oauth_authorization_states_status_check).toContain("status::text = 'pending'::text");
    expect(definitions.oauth_authorization_states_status_check).toContain("status::text = 'consumed'::text");
    for (const column of [
      'id', 'provider', 'organization_id', 'user_id', 'auth_session_id',
      'state_hash', 'status', 'created_at', 'expires_at',
    ]) {
      expect(definitions[`oauth_authorization_states_${column}_not_null`]).toBe(`NOT NULL ${column}`);
    }

    const indexes = await pool.query(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'oauth_authorization_states'
        ORDER BY indexname`
    );
    expect(indexes.rows.map(row => row.indexname)).toEqual([
      'oauth_authorization_states_consumed_cleanup',
      'oauth_authorization_states_hash_unique',
      'oauth_authorization_states_organization_provider',
      'oauth_authorization_states_pending_expiry',
      'oauth_authorization_states_pkey',
    ]);
    const indexDefinitions = Object.fromEntries(indexes.rows.map(row => [row.indexname, row.indexdef]));
    expect(indexDefinitions.oauth_authorization_states_pkey).toContain('UNIQUE INDEX oauth_authorization_states_pkey');
    expect(indexDefinitions.oauth_authorization_states_hash_unique).toContain('(state_hash)');
    expect(indexDefinitions.oauth_authorization_states_pending_expiry)
      .toContain("(expires_at, id) WHERE ((status)::text = 'pending'::text)");
    expect(indexDefinitions.oauth_authorization_states_consumed_cleanup)
      .toContain("(consumed_at, id) WHERE ((status)::text = 'consumed'::text)");
    expect(indexDefinitions.oauth_authorization_states_organization_provider)
      .toContain('(organization_id, provider, created_at DESC)');

    const sessionConstraint = await pool.query(
      `SELECT pg_get_constraintdef(oid, TRUE) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.auth_sessions'::regclass
          AND conname = 'auth_sessions_organization_user_identity'`
    );
    expect(sessionConstraint.rows).toEqual([{ definition: 'UNIQUE (organization_id, user_id, id)' }]);
    const sequence = await pool.query(
      "SELECT pg_get_serial_sequence('public.oauth_authorization_states', 'id') AS sequence_name"
    );
    expect(sequence.rows).toEqual([{ sequence_name: null }]);
  });

  test('production-mounted Jobber status and OAuth fail closed before state, redirect, exchange, or persistence', async () => {
    const authority = await createVerifiedOwner('production-unavailable');
    const beforeCount = await sessionStateCount(authority);
    expect(beforeCount).toBe(0);
    for (const name of [
      'JOBBER_INTEGRATION_ENABLED',
      'JOBBER_OAUTH_ENABLED',
      'JOBBER_TOKEN_PERSISTENCE_ENABLED',
    ]) process.env[name] = 'true';

    const forged = {
      code: `provider-code-${crypto.randomUUID()}`,
      state: crypto.randomBytes(32).toString('base64url'),
      organizationId: `foreign-${crypto.randomUUID()}`,
      userId: `forged-${crypto.randomUUID()}`,
      role: 'owner',
      email: `private-${crypto.randomUUID()}@example.test`,
    };
    const status = await request(productionApp).get('/api/integrations/jobber/status')
      .set('Cookie', authority.cookie)
      .query(forged);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      available: false,
      configured: false,
      connected: false,
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
    });
    expect(status.headers['x-request-id']).toBe(status.body.requestId);
    expect(status.headers['x-correlation-id']).toBe(status.body.requestId);
    expect(status.body).not.toHaveProperty('hasClientId');
    expect(status.body).not.toHaveProperty('hasClientSecret');
    expect(status.body).not.toHaveProperty('clientIdLength');

    const start = await request(productionApp).get('/api/integrations/jobber/auth')
      .set('Cookie', authority.cookie)
      .query(forged);
    const callbackResponse = await request(productionApp).get('/api/integrations/jobber/callback')
      .set('Cookie', authority.cookie)
      .query(forged);
    const disconnectResponse = await request(productionApp).post('/api/integrations/jobber/disconnect')
      .set(authority.headers)
      .send({ ...forged });
    expectProductionUnavailable(start);
    expectProductionUnavailable(callbackResponse);
    expectProductionUnavailable(disconnectResponse);
    expect(await sessionStateCount(authority)).toBe(0);

    const surface = [
      status.text,
      start.text,
      callbackResponse.text,
      JSON.stringify(status.headers),
      JSON.stringify(start.headers),
      JSON.stringify(callbackResponse.headers),
      disconnectResponse.text,
      JSON.stringify(disconnectResponse.headers),
    ].join('\n');
    for (const privateValue of [
      ...Object.values(forged),
      authority.user_id,
      authority.session_id,
      authority.organization_id,
      authority.role,
      authority.email,
      process.env.JOBBER_CLIENT_ID,
      process.env.JOBBER_CLIENT_SECRET,
      'api.getjobber.com',
      'oauth_authorization_states',
    ]) {
      expect(surface).not.toContain(String(privateValue));
    }
    expectNoJobberCapabilityUse();
  }, 30000);

  test('pending and viewer callers are denied before the production capability response', async () => {
    const pending = await createVerifiedOwner('production-pending');
    await pool.query("UPDATE users SET status = 'pending_verification' WHERE id = $1", [pending.user_id]);
    const pendingResponse = await request(productionApp).get('/api/integrations/jobber/auth')
      .set('Cookie', pending.cookie);
    expect(pendingResponse.status).toBe(403);
    expect(pendingResponse.body.code).toBe('verification_required');
    expect(pendingResponse.body.code).not.toBe('jobber_unavailable');

    const viewer = await createVerifiedOwner('production-viewer');
    await pool.query(
      "UPDATE organization_memberships SET role = 'viewer', updated_at = NOW() WHERE id = $1",
      [viewer.membership_id]
    );
    const viewerResponse = await request(productionApp).get('/api/integrations/jobber/auth')
      .set('Cookie', viewer.cookie)
      .query({ role: 'owner', organizationId: pending.organization_id });
    expect(viewerResponse.status).toBe(403);
    expect(viewerResponse.body.error).toBe('Insufficient permissions');
    expect(viewerResponse.body).not.toHaveProperty('code', 'jobber_unavailable');

    expect(await sessionStateCount(pending)).toBe(0);
    expect(await sessionStateCount(viewer)).toBe(0);
    expectNoJobberCapabilityUse();
  }, 30000);

  test('authorization redirects expose only distinct 256-bit opaque state and PostgreSQL stores only hashes', async () => {
    const authority = await createVerifiedOwner('opacity');
    const first = await authorize(authority);
    const second = await authorize(authority);
    expect(first.state).not.toBe(second.state);
    for (const issued of [first, second]) {
      expect(issued.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(issued.state, 'base64url')).toHaveLength(32);
      expect(issued.state.split('.')).toHaveLength(1);
      expect(() => JSON.parse(Buffer.from(issued.state, 'base64url').toString('utf8'))).toThrow();
      const disclosed = [
        authority.user_id,
        authority.session_id,
        authority.organization_id,
        authority.role,
        authority.email,
      ];
      const surface = [
        issued.response.headers.location,
        issued.response.text,
        JSON.stringify(issued.response.headers),
      ].join('\n');
      for (const identity of disclosed) {
        for (const representation of identifierRepresentations(identity)) {
          expect(surface).not.toContain(representation);
        }
      }
    }
    const firstRow = await stateRow(authority, first.state);
    const secondRow = await stateRow(authority, second.state);
    expect(firstRow.state_hash).toBe(
      crypto.createHash('sha256').update(first.state, 'utf8').digest('hex')
    );
    expect(secondRow.state_hash).toBe(
      crypto.createHash('sha256').update(second.state, 'utf8').digest('hex')
    );
    expect(JSON.stringify([firstRow, secondRow])).not.toContain(first.state);
    expect(JSON.stringify([firstRow, secondRow])).not.toContain(second.state);
    expect(firstRow).toMatchObject({
      provider: 'jobber',
      organization_id: authority.organization_id,
      user_id: authority.user_id,
      auth_session_id: authority.session_id,
      status: 'pending',
      consumed_at: null,
    });
    expect(firstRow.expires_at.getTime() - firstRow.created_at.getTime()).toBe(10 * 60 * 1000);
    const columns = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'oauth_authorization_states'
        ORDER BY ordinal_position`
    );
    expect(columns.rows.map(row => row.column_name)).toEqual([
      'id', 'provider', 'organization_id', 'user_id', 'auth_session_id',
      'state_hash', 'status', 'created_at', 'expires_at', 'consumed_at',
    ]);
    expect(columns.rows.map(row => row.column_name)).not.toContain('state');
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('an unexpected authorization URL failure returns a bounded response without error or identity disclosure', async () => {
    const authority = await createVerifiedOwner('authorization-error');
    const privateDiagnostic = `private-diagnostic-${crypto.randomUUID()}`;
    authUrlSpy.mockImplementationOnce(() => {
      throw new Error(privateDiagnostic);
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).get('/api/integrations/jobber/auth')
        .set('Cookie', authority.cookie);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to begin Jobber authorization',
        code: 'jobber_authorization_failed',
        requestId: 'unavailable',
      });
      expect(response.text).not.toContain(privateDiagnostic);
      expect(response.text).not.toContain(authority.user_id);
      expect(response.text).not.toContain(authority.session_id);
      expect(response.text).not.toContain(authority.organization_id);
      expect(consoleSpy).toHaveBeenCalledWith('[Jobber] OAuth authorization failed');
    } finally {
      consoleSpy.mockRestore();
    }
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('test-only route capability never reports connected without accepted persistence', async () => {
    const authority = await createVerifiedOwner('honest-persistence');

    const noToken = await authorize(authority);
    exchangeSpy.mockResolvedValueOnce({ token_type: 'Bearer' });
    const noTokenResponse = await callback(authority, noToken.state);
    expect(noTokenResponse.status).toBe(502);
    expect(noTokenResponse.headers.location).toBeUndefined();
    expect(noTokenResponse.body).toEqual({
      error: 'Failed to connect Jobber',
      code: 'jobber_connection_failed',
      requestId: 'unavailable',
    });
    expect(saveSpy).not.toHaveBeenCalled();

    const unpersisted = await authorize(authority);
    saveSpy.mockResolvedValueOnce(false);
    const unpersistedResponse = await callback(authority, unpersisted.state);
    expect(unpersistedResponse.status).toBe(503);
    expect(unpersistedResponse.headers.location).toBeUndefined();
    expect(unpersistedResponse.body).toEqual({
      error: 'Jobber connection could not be confirmed',
      code: 'jobber_connection_unavailable',
      requestId: 'unavailable',
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await realSaveTokens(
        authority.user_id,
        'intercepted-unpersisted-access',
        'intercepted-unpersisted-refresh',
        3600
      )).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('[Jobber] Token persistence failed');
    } finally {
      consoleSpy.mockRestore();
    }
    expect(exchangeSpy).toHaveBeenCalledTimes(2);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expectNoTransmission();
  }, 30000);

  test('test-only disconnect capability reports success only after exact durable confirmation', async () => {
    const authority = await createVerifiedOwner('disconnect-contract');
    const success = await request(app).post('/api/integrations/jobber/disconnect')
      .set(authority.headers)
      .send({});
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ success: true, requestId: 'unavailable' });
    expect(disconnectSpy).toHaveBeenCalledWith({
      provider: 'jobber',
      organizationId: authority.organization_id,
      userId: authority.user_id,
      sessionId: authority.session_id,
    });

    for (const outcome of [false, undefined]) {
      disconnectSpy.mockResolvedValueOnce(outcome);
      const failed = await request(app).post('/api/integrations/jobber/disconnect')
        .set(authority.headers)
        .send({});
      expectProductionUnavailable(failed);
    }
    disconnectSpy.mockRejectedValueOnce(new Error('private test-only persistence failure'));
    const rejected = await request(app).post('/api/integrations/jobber/disconnect')
      .set(authority.headers)
      .send({});
    expectProductionUnavailable(rejected);
    expect(disconnectSpy).toHaveBeenCalledTimes(4);
    expect(legacyDisconnectSpy).not.toHaveBeenCalled();
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('a non-2xx Jobber token response is rejected without parsing or disclosing its body', async () => {
    const authority = await createVerifiedOwner('exchange-status');
    const issued = await authorize(authority);
    const privateProviderBody = `private-provider-body-${crypto.randomUUID()}`;
    httpsSpy.mockImplementationOnce((_url, _options, onResponse) => {
      const outgoing = new EventEmitter();
      outgoing.write = () => {};
      outgoing.end = () => {
        const incoming = new EventEmitter();
        incoming.statusCode = 401;
        onResponse(incoming);
        setImmediate(() => {
          incoming.emit('data', Buffer.from(privateProviderBody));
          incoming.emit('end');
        });
      };
      return outgoing;
    });
    exchangeSpy.mockImplementationOnce((code, redirectBase) => realExchangeCode(code, redirectBase));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await callback(authority, issued.state);
      expect(response.status).toBe(500);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toEqual({
        error: 'Failed to connect Jobber',
        code: 'jobber_connection_failed',
        requestId: 'unavailable',
      });
      expect(response.text).not.toContain(privateProviderBody);
      expect(consoleSpy).toHaveBeenCalledWith('[Jobber] OAuth callback failed');
    } finally {
      consoleSpy.mockRestore();
    }
    expect(httpsSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
    if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled();
  }, 30000);

  test('test-only route capability consumes once and denies replay before exchange', async () => {
    const authority = await createVerifiedOwner('single-use');
    const { state } = await authorize(authority);
    const success = await callback(authority, state);
    expect(success.status).toBe(302);
    expect(success.headers.location).toBe('/dashboard/integrations?jobber=connected');
    expect(exchangeSpy).toHaveBeenCalledTimes(1);
    expect(exchangeSpy.mock.calls[0][0]).toBe('intercepted-jobber-code');
    expect(saveSpy).toHaveBeenCalledWith({
      provider: 'jobber',
      organizationId: authority.organization_id,
      userId: authority.user_id,
      sessionId: authority.session_id,
      accessToken: 'intercepted-jobber-access',
      refreshToken: 'intercepted-jobber-refresh',
      expiresIn: 3600,
    });
    const row = await stateRow(authority, state);
    expect(row.status).toBe('consumed');
    expect(row.consumed_at).toBeInstanceOf(Date);

    const replay = await callback(authority, state, 'must-not-exchange');
    expect(replay.status).toBe(403);
    expect(replay.body).toEqual({
      error: 'Integration authorization state is invalid',
      code: 'integration_state_invalid',
      requestId: 'unavailable',
    });
    expect(exchangeSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expectNoTransmission();
  }, 30000);

  test('missing, malformed, expired, and wrong-provider state fail without provider exchange', async () => {
    const authority = await createVerifiedOwner('invalid');
    const missing = await request(app).get('/api/integrations/jobber/callback')
      .set('Cookie', authority.cookie).query({ code: 'missing-state' });
    expect(missing.status).toBe(400);
    for (const malformed of [
      'short',
      'eyJzdWIiOiJyZWFkYWJsZSJ9.payload.signature',
      'A'.repeat(42),
      'A'.repeat(44),
      'A'.repeat(4096),
      'not+url/safe'.padEnd(43, 'x'),
    ]) {
      const rejected = await callback(authority, malformed);
      expect(rejected.status).toBe(403);
      expect(rejected.body.code).toBe('integration_state_invalid');
    }

    const expiredIssued = await authorize(authority);
    const expiredRow = await stateRow(authority, expiredIssued.state);
    await pool.query(
      `UPDATE oauth_authorization_states
          SET created_at = NOW() - INTERVAL '20 minutes',
              expires_at = NOW() - INTERVAL '10 minutes'
        WHERE id = $1`,
      [expiredRow.id]
    );
    expect((await callback(authority, expiredIssued.state)).status).toBe(403);
    expect(await stateCount(expiredIssued.state)).toBe(0);

    const wrongProviderIssued = await authorize(authority);
    const wrongProviderRow = await stateRow(authority, wrongProviderIssued.state);
    await pool.query(
      "UPDATE oauth_authorization_states SET provider = 'google' WHERE id = $1",
      [wrongProviderRow.id]
    );
    expect((await callback(authority, wrongProviderIssued.state)).status).toBe(403);
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('revoked session, revoked membership, and another organization fail without disclosure or consumption', async () => {
    const revokedSession = await createVerifiedOwner('revoked-session');
    const sessionState = await authorize(revokedSession);
    await pool.query(
      `UPDATE auth_sessions
          SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'oauth_state_test'
        WHERE id = $1`,
      [revokedSession.session_id]
    );
    const revokedResponse = await callback(revokedSession, sessionState.state);
    expect(revokedResponse.status).toBe(401);
    expect((await stateRow(revokedSession, sessionState.state)).status).toBe('pending');

    const revokedMembership = await createVerifiedOwner('revoked-membership');
    const membershipState = await authorize(revokedMembership);
    await pool.query(
      `UPDATE organization_memberships
          SET status = 'revoked', revoked_at = NOW()
        WHERE id = $1`,
      [revokedMembership.membership_id]
    );
    const membershipResponse = await callback(revokedMembership, membershipState.state);
    expect(membershipResponse.status).toBe(403);
    expect((await stateRow(revokedMembership, membershipState.state)).status).toBe('pending');

    const owner = await createVerifiedOwner('cross-owner');
    const other = await createVerifiedOwner('cross-other');
    const crossState = await authorize(owner);
    const wrongAccount = await callback(other, crossState.state);
    expect(wrongAccount.status).toBe(403);
    expect(wrongAccount.body.code).toBe('integration_state_invalid');
    for (const identity of [
      owner.user_id, owner.session_id, owner.organization_id,
      other.user_id, other.session_id, other.organization_id,
    ]) {
      expect(wrongAccount.text).not.toContain(identity);
    }
    const stillPending = await stateRow(owner, crossState.state);
    expect(stillPending.status).toBe('pending');
    expect((await callback(owner, crossState.state)).status).toBe(302);

    expect(exchangeSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expectNoTransmission();
  }, 30000);

  test('post-issuance verification, onboarding, role, and expiry downgrades deny while state remains pending', async () => {
    const cases = [
      {
        label: 'verification-downgrade',
        mutate: authority => pool.query(
          "UPDATE users SET status = 'pending_verification' WHERE id = $1",
          [authority.user_id]
        ),
        status: 403,
        code: 'verification_required',
      },
      {
        label: 'onboarding-downgrade',
        mutate: async authority => {
          await pool.query(
            `UPDATE canonical_business_profiles
                SET is_active = FALSE, retired_at = NOW()
              WHERE organization_id = $1`,
            [authority.organization_id]
          );
          return pool.query(
            `UPDATE organization_onboarding
              SET status = 'business_profile_required',
                  active_business_profile_id = NULL,
                  completed_at = NULL,
                  updated_at = NOW()
             WHERE organization_id = $1`,
            [authority.organization_id]
          );
        },
        status: 403,
        code: 'onboarding_required',
      },
      {
        label: 'role-downgrade',
        mutate: authority => pool.query(
          "UPDATE organization_memberships SET role = 'viewer', updated_at = NOW() WHERE id = $1",
          [authority.membership_id]
        ),
        status: 403,
      },
      {
        label: 'access-expiry',
        mutate: authority => pool.query(
          "UPDATE auth_sessions SET access_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
          [authority.session_id]
        ),
        status: 401,
        code: 'access_expired',
      },
      {
        label: 'refresh-expiry',
        mutate: authority => pool.query(
          `UPDATE auth_sessions
              SET access_expires_at = NOW() - INTERVAL '2 minutes',
                  refresh_expires_at = NOW() - INTERVAL '1 minute'
            WHERE id = $1`,
          [authority.session_id]
        ),
        status: 401,
        code: 'access_expired',
      },
    ];
    for (const scenario of cases) {
      const authority = await createVerifiedOwner(scenario.label);
      const issued = await authorize(authority);
      await scenario.mutate(authority);
      const denied = await callback(authority, issued.state);
      expect(denied.status).toBe(scenario.status);
      if (scenario.code) expect(denied.body.code).toBe(scenario.code);
      expect((await stateRow(authority, issued.state)).status).toBe('pending');
    }
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 60000);

  test('the same user in a different durable session cannot consume the first session state', async () => {
    const authority = await createVerifiedOwner('different-session');
    const issued = await authorize(authority);
    const login = await request(app).post('/api/auth/login').send({
      email: authority.email,
      password: authority.password,
    });
    expect(login.status).toBe(200);
    const secondCookies = responseCookies(login);
    const secondCookie = cookieHeader(secondCookies);
    const secondSession = await pool.query(
      `SELECT id
         FROM auth_sessions
        WHERE user_id = $1 AND id <> $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [authority.user_id, authority.session_id]
    );
    expect(secondSession.rows).toHaveLength(1);
    const denied = await callback({ cookie: secondCookie }, issued.state);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('integration_state_invalid');
    expect((await stateRow(authority, issued.state)).status).toBe('pending');
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('an issuance INSERT failure returns bounded 503 with no redirect or orphan and retry succeeds', async () => {
    const authority = await createVerifiedOwner('issuance-fault');
    const before = await pool.query(
      'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE auth_session_id = $1',
      [authority.session_id]
    );
    await pool.query(
      `CREATE FUNCTION oauth_state_test_reject_issuance()
       RETURNS TRIGGER AS $$
       BEGIN
         RAISE EXCEPTION 'injected oauth state issuance failure';
       END;
       $$ LANGUAGE plpgsql`
    );
    await pool.query(
      `CREATE TRIGGER oauth_state_test_reject_issuance
         BEFORE INSERT ON oauth_authorization_states
         FOR EACH ROW
         EXECUTE FUNCTION oauth_state_test_reject_issuance()`
    );
    try {
      const failed = await request(app).get('/api/integrations/jobber/auth')
        .set('Cookie', authority.cookie);
      expect(failed.status).toBe(503);
      expect(failed.headers.location).toBeUndefined();
      expect(failed.body).toEqual({
        error: 'Integration authorization is temporarily unavailable',
        code: 'integration_state_unavailable',
        requestId: 'unavailable',
      });
      const after = await pool.query(
        'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE auth_session_id = $1',
        [authority.session_id]
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
      expect(exchangeSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
      expectNoTransmission();
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS oauth_state_test_reject_issuance ON oauth_authorization_states');
      await pool.query('DROP FUNCTION IF EXISTS oauth_state_test_reject_issuance()');
    }
    const retry = await authorize(authority);
    expect(await stateCount(retry.state)).toBe(1);
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('a PostgreSQL consumption failure rolls back state and fails closed before provider exchange', async () => {
    const authority = await createVerifiedOwner('database-fault');
    const { state } = await authorize(authority);
    await pool.query(
      `CREATE FUNCTION oauth_state_test_reject_consumption()
       RETURNS TRIGGER AS $$
       BEGIN
         RAISE EXCEPTION 'injected oauth state consumption failure';
       END;
       $$ LANGUAGE plpgsql`
    );
    await pool.query(
      `CREATE TRIGGER oauth_state_test_reject_consumption
         BEFORE UPDATE OF status ON oauth_authorization_states
         FOR EACH ROW
         WHEN (NEW.status = 'consumed')
         EXECUTE FUNCTION oauth_state_test_reject_consumption()`
    );
    try {
      const failed = await callback(authority, state);
      expect(failed.status).toBe(503);
      expect(failed.body).toEqual({
        error: 'Integration authorization is temporarily unavailable',
        code: 'integration_state_unavailable',
        requestId: 'unavailable',
      });
      expect(exchangeSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect((await stateRow(authority, state)).status).toBe('pending');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS oauth_state_test_reject_consumption ON oauth_authorization_states');
      await pool.query('DROP FUNCTION IF EXISTS oauth_state_test_reject_consumption()');
    }
    const retry = await callback(authority, state);
    expect(retry.status).toBe(302);
    expect(exchangeSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expectNoTransmission();
  }, 30000);

  test('opportunistic cleanup removes at most 100 stale rows per authorization and requires no timer', async () => {
    const authority = await createVerifiedOwner('cleanup');
    await pool.query(
      `INSERT INTO oauth_authorization_states (
         provider, organization_id, user_id, auth_session_id, state_hash,
         status, created_at, expires_at, consumed_at
       )
       SELECT 'jobber', $1, $2, $3, lpad(to_hex(value), 64, '0'),
              'consumed',
              NOW() - INTERVAL '2 days',
              NOW() - INTERVAL '2 days' + INTERVAL '10 minutes',
              NOW() - INTERVAL '2 days' + INTERVAL '1 minute'
         FROM generate_series(1, 105) value`,
      [authority.organization_id, authority.user_id, authority.session_id]
    );
    await authorize(authority);
    const afterFirst = await pool.query(
      `SELECT count(*)::int AS count
         FROM oauth_authorization_states
        WHERE auth_session_id = $1
          AND status = 'consumed'
          AND consumed_at <= NOW() - INTERVAL '24 hours'`,
      [authority.session_id]
    );
    expect(afterFirst.rows[0].count).toBe(5);
    await authorize(authority);
    const afterSecond = await pool.query(
      `SELECT count(*)::int AS count
         FROM oauth_authorization_states
        WHERE auth_session_id = $1
          AND status = 'consumed'
          AND consumed_at <= NOW() - INTERVAL '24 hours'`,
      [authority.session_id]
    );
    expect(afterSecond.rows[0].count).toBe(0);
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 30000);

  test('a fresh Node process consumes state issued before restart from durable PostgreSQL authority', async () => {
    const authority = await createVerifiedOwner('restart');
    const { state } = await authorize(authority);
    const worker = startCallbackWorker(allocation.connectionString, process.env.AUTH_ACCESS_SECRET);
    await worker.ready;
    const outcome = await worker.run({ cookie: authority.cookie, state });
    expect(outcome).toMatchObject({ status: 302, exchangeCalls: 1, saveCalls: 1 });
    expect((await stateRow(authority, state)).status).toBe('consumed');
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 60000);

  test('two independent Node processes racing one state produce exactly one consumer', async () => {
    const authority = await createVerifiedOwner('process-race');
    const { state } = await authorize(authority);
    const workers = [
      startCallbackWorker(allocation.connectionString, process.env.AUTH_ACCESS_SECRET),
      startCallbackWorker(allocation.connectionString, process.env.AUTH_ACCESS_SECRET),
    ];
    await Promise.all(workers.map(worker => worker.ready));
    const outcomes = await Promise.all(workers.map(worker => worker.run({
      cookie: authority.cookie,
      state,
    })));
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual([302, 403]);
    expect(outcomes.reduce((total, outcome) => total + outcome.exchangeCalls, 0)).toBe(1);
    expect(outcomes.reduce((total, outcome) => total + outcome.saveCalls, 0)).toBe(1);
    expect((await stateRow(authority, state)).status).toBe('consumed');
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 60000);

  test('fresh production construction stays unavailable across every environment-boolean combination', async () => {
    const authority = await createVerifiedOwner('production-processes');
    const { state } = await authorize(authority);
    authUrlSpy.mockClear();
    issueStateSpy.mockClear();

    const combinations = [];
    for (const integration of ['false', 'true']) {
      for (const oauth of ['false', 'true']) {
        for (const persistence of ['false', 'true']) {
          combinations.push({
            JOBBER_INTEGRATION_ENABLED: integration,
            JOBBER_OAUTH_ENABLED: oauth,
            JOBBER_TOKEN_PERSISTENCE_ENABLED: persistence,
          });
        }
      }
    }
    const workers = combinations.map(environment =>
      startCallbackWorker(
        allocation.connectionString,
        process.env.AUTH_ACCESS_SECRET,
        false,
        environment
      )
    );
    await Promise.all(workers.map(worker => worker.ready));
    const outcomes = await Promise.all(workers.map(worker => worker.run({
      cookie: authority.cookie,
      state,
    })));
    expect(outcomes).toHaveLength(8);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        status: 503,
        code: 'jobber_unavailable',
        exchangeCalls: 0,
        saveCalls: 0,
      });
    }
    expect((await stateRow(authority, state)).status).toBe('pending');
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(legacySaveSpy).not.toHaveBeenCalled();
    expect(consumeStateSpy).not.toHaveBeenCalled();
    expectNoTransmission();
  }, 120000);

  test('a real PostgreSQL authority outage fails before the unavailable Jobber capability boundary', async () => {
    const authority = await createVerifiedOwner('production-database-outage');
    await db.close();
    try {
      const response = await request(productionApp).get('/api/integrations/jobber/auth')
        .set('Cookie', authority.cookie);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('authorization_unavailable');
      expect(response.body.code).not.toBe('jobber_unavailable');
      expect(response.headers.location).toBeUndefined();
      expect(response.headers['set-cookie']).toBeUndefined();
      expectNoJobberCapabilityUse();
    } finally {
      expect(await db.initDatabase()).toBe(true);
      pool = db.getPool();
    }
  }, 60000);
});
