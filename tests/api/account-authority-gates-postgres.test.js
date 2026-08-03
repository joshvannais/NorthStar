'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { fork } = require('child_process');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

function cookies(response) {
  const result = {};
  for (const value of response.headers['set-cookie'] || []) {
    const pair = value.split(';')[0];
    const separator = pair.indexOf('=');
    result[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
  }
  return result;
}

function cookieHeader(values) {
  return Object.entries(values).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

function runProductionCapabilityWorker(connectionString, configuration, marker, expectEnabled = false, providerStatus = 200) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, '../helpers/account-production-capability-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        AUTH_ACCESS_SECRET: crypto.randomBytes(48).toString('hex'),
      },
      silent: true,
    });
    let stderr = '';
    let outcome;
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', message => {
      if (message.type === 'result') outcome = message;
      if (message.type === 'error') reject(new Error(`${message.message}\n${stderr}`));
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0 || !outcome) reject(new Error(`capability worker exited ${code}\n${stderr}`));
      else resolve(outcome);
    });
    child.send({ configuration, marker, expectEnabled, providerStatus });
  });
}

describe('mounted account authority gates on required PostgreSQL 18', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let providerSpies;
  let voiceSessions;
  let providerAgentSequence = 0;
  let providerCallSequence = 0;
  const original = {};

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) throw new Error('Disposable PostgreSQL 18 identity is required');
    allocation = await createSuiteDatabase('account-authority-gates');
    for (const key of [
      'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'ACCOUNT_SIGNUP_ENABLED',
      'ACCOUNT_VERIFICATION_DELIVERY_READY', 'AUTH_BEARER_COMPAT_ENABLED',
      'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
    ]) original[key] = process.env[key];
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'true';
    process.env.AUTH_BEARER_COMPAT_ENABLED = 'true';
    process.env.JOBBER_CLIENT_ID = 'disposable-jobber-client';
    process.env.JOBBER_CLIENT_SECRET = 'disposable-jobber-secret';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    const calendar = require('../../src/calendar/client');
    const emailNotifications = require('../../src/notifications/email');
    const smsNotifications = require('../../src/notifications/sms');
    const retell = require('../../src/retell/client');
    const jobber = require('../../src/integrations/jobber');
    const connectionCapability = {
      stateAuthority: require('../../src/integrations/oauthAuthorizationState'),
      persistConnection: async () => true,
      readConnectionStatus: async () => ({ connected: false }),
      disconnectConnection: async () => true,
    };
    voiceSessions = require('../../src/services/voiceSessionAuthority');
    providerSpies = {
      calendarSchedule: jest.spyOn(calendar, 'scheduleEstimate').mockResolvedValue({
        success: true, eventId: 'intercepted-calendar-provider',
      }),
      emailNotification: jest.spyOn(emailNotifications, 'sendLeadNotification').mockResolvedValue(undefined),
      smsNotification: jest.spyOn(smsNotifications, 'sendLeadNotification').mockResolvedValue(undefined),
      retellAgent: jest.spyOn(retell, 'createAgent').mockImplementation(async () => ({
        agent_id: `intercepted-agent-${++providerAgentSequence}`,
      })),
      retellSms: jest.spyOn(retell, 'sendSMS').mockResolvedValue({
        success: true, intercepted: true,
      }),
      retellCall: jest.spyOn(retell, 'createCall').mockImplementation(async () => ({
        call_id: `intercepted-call-${++providerCallSequence}`,
        call_status: 'registered',
      })),
      jobberAuth: jest.spyOn(jobber, 'getAuthUrl').mockImplementation(state => (
        `https://provider.invalid/jobber?state=${encodeURIComponent(state)}`
      )),
      jobberExchange: jest.spyOn(jobber, 'exchangeCode').mockResolvedValue({
        access_token: 'intercepted-jobber-access',
        refresh_token: 'intercepted-jobber-refresh',
        expires_in: 3600,
      }),
      jobberSave: jest.spyOn(connectionCapability, 'persistConnection').mockResolvedValue(true),
      jobberStatus: jest.spyOn(connectionCapability, 'readConnectionStatus')
        .mockResolvedValue({ connected: false }),
      externalFetch: jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected external fetch')),
      externalHttps: jest.spyOn(https, 'request').mockImplementation(() => {
        throw new Error('unexpected external HTTPS request');
      }),
    };
    app = require('../helpers/account-test-app').createDisposableAccountApp({
      jobberConnectionCapability: connectionCapability,
    });
  }, 60000);

  afterAll(async () => {
    if (voiceSessions) voiceSessions.clearRuntimeHandlesForTests();
    if (providerSpies) {
      for (const spy of Object.values(providerSpies)) spy.mockRestore();
    }
    if (db) await db.close();
    if (allocation) await allocation.cleanup();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }, 60000);

  async function signup(email) {
    await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
    const created = await request(app).post('/api/auth/signup').send({
      name: 'Gate Owner', businessName: `Gate ${email}`, phone: '8605550101',
      email, password: 'durable gate password',
    });
    expect(created.status).toBe(202);
    const login = await request(app).post('/api/auth/login').send({
      email, password: 'durable gate password',
    });
    expect(login.status).toBe(200);
    return login;
  }

  async function activateTrialForEmail(email) {
    const result = await pool.query(
      `WITH activated_user AS (
         UPDATE users SET status = 'active', updated_at = clock_timestamp()
          WHERE email_normalized = $1
          RETURNING organization_id
       ), activated_subscription AS (
         UPDATE subscriptions subscription
            SET status = 'trialing',
                trial_started_at = transaction_timestamp(),
                trial_ends_at = transaction_timestamp() + INTERVAL '14 days',
                updated_at = transaction_timestamp()
           FROM activated_user
          WHERE subscription.organization_id = activated_user.organization_id
          RETURNING subscription.organization_id
       )
       UPDATE organization_onboarding onboarding
          SET status = CASE WHEN onboarding.active_business_profile_id IS NULL
                            THEN 'business_profile_required' ELSE 'complete' END,
              updated_at = clock_timestamp()
         FROM activated_subscription
        WHERE onboarding.organization_id = activated_subscription.organization_id
        RETURNING onboarding.organization_id`,
      [email.trim().toLowerCase()]
    );
    expect(result.rows).toHaveLength(1);
  }

  function clearProviderSpies() {
    for (const spy of Object.values(providerSpies)) spy.mockClear();
  }

  function expectNoProviderCalls() {
    for (const spy of Object.values(providerSpies)) expect(spy).not.toHaveBeenCalled();
  }

  test('production mount rejects signup despite every environment boolean and performs zero writes/cookies', async () => {
    const before = await pool.query('SELECT count(*)::int AS count FROM organizations');
    const productionApp = require('../../src/server').app;
    const querySpy = jest.spyOn(pool, 'query');
    const response = await request(productionApp).post('/api/auth/signup').send({
      name: 'No Write', businessName: 'No Write', phone: '8605550102',
      email: 'production-disabled@example.test', password: 'durable gate password',
    });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('signup_disabled');
    expect(response.headers['set-cookie']).toBeUndefined();
    await new Promise(resolve => setImmediate(resolve));
    const writes = querySpy.mock.calls.filter(([statement]) => (
      /^(?:\s|\/\*[\s\S]*?\*\/)*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(String(statement))
    ));
    querySpy.mockRestore();
    expect(writes).toEqual([]);
    const after = await pool.query('SELECT count(*)::int AS count FROM organizations');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  test('fresh production construction requires valid Resend authority and never falls back to SMTP', async () => {
    const valid = {
      PUBLIC_ORIGIN: 'https://www.northstar-os.ai', RESEND_API_KEY: 're_local_capture_only',
      TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai',
      TRANSACTIONAL_EMAIL_FROM_NAME: 'Attacker Controlled', ACCOUNT_SIGNUP_ENABLED: 'true',
      ACCOUNT_VERIFICATION_DELIVERY_READY: 'true', SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587', SMTP_USER: 'smtp-user', SMTP_PASS: 'retired-secret',
    };
    const invalid = [
      ['missing-key', { RESEND_API_KEY: '' }],
      ['key-leading-space', { RESEND_API_KEY: ' re_local_capture_only' }],
      ['key-trailing-space', { RESEND_API_KEY: 're_local_capture_only ' }],
      ['key-tab', { RESEND_API_KEY: 're_local\tcapture' }],
      ['key-cr', { RESEND_API_KEY: 're_local\rcapture' }],
      ['key-lf', { RESEND_API_KEY: 're_local\ncapture' }],
      ['key-nul', { RESEND_API_KEY: `re_local${String.fromCharCode(0)}capture` }],
      ['key-del', { RESEND_API_KEY: `re_local${String.fromCharCode(127)}capture` }],
      ['key-oversized', { RESEND_API_KEY: 'a'.repeat(4097) }],
      ['key-non-ascii', { RESEND_API_KEY: 'opaque-é' }],
      ['missing-sender', { TRANSACTIONAL_EMAIL_FROM: '' }],
      ['formatted-sender', {
        TRANSACTIONAL_EMAIL_FROM: 'NorthStar Notifications <notifications@northstar-os.ai>',
      }],
      ['sender-injection', { TRANSACTIONAL_EMAIL_FROM: 'notifications@northstar-os.ai\r\nBcc:x@example.test' }],
      ['sender-nul', { TRANSACTIONAL_EMAIL_FROM: `notifications${String.fromCharCode(0)}@northstar-os.ai` }],
      ['sender-list', { TRANSACTIONAL_EMAIL_FROM: 'one@example.test,two@example.test' }],
      ['sender-mailbox', { TRANSACTIONAL_EMAIL_FROM: 'attacker@northstar-os.ai' }],
      ['insecure-origin', { PUBLIC_ORIGIN: 'http://www.northstar-os.ai' }],
      ['foreign-origin', { PUBLIC_ORIGIN: 'https://attacker.example' }],
      ['origin-path', { PUBLIC_ORIGIN: 'https://www.northstar-os.ai/path' }],
      ['origin-query', { PUBLIC_ORIGIN: 'https://www.northstar-os.ai?next=attacker' }],
    ];
    for (const [label, mutation] of invalid) {
      const result = await runProductionCapabilityWorker(
        allocation.connectionString, { ...valid, ...mutation }, `invalid-${label}`
      );
      expect(result.status).toBe(503);
      expect(result.cookies).toEqual([]);
      expect(result.after).toEqual(result.before);
      expect(result.transportConstructions).toBe(0);
      expect(result.providerRequests).toBe(0);
      expect(result.dnsCalls + result.netCalls + result.tlsCalls).toBe(0);
      const rejectedValue = String(Object.values(mutation)[0]);
      if (rejectedValue.length >= 8) expect(result.disclosure).not.toContain(rejectedValue);
    }

    const smtpOnly = await runProductionCapabilityWorker(
      allocation.connectionString,
      { ...valid, RESEND_API_KEY: undefined },
      'smtp-only-disabled'
    );
    expect(smtpOnly.status).toBe(503);
    expect(smtpOnly.after).toEqual(smtpOnly.before);
    expect(smtpOnly.providerRequests).toBe(0);
    expect(smtpOnly.transportConstructions).toBe(0);

    const positive = await runProductionCapabilityWorker(
      allocation.connectionString, valid, 'valid-local-capture', true
    );
    expect(positive.status).toBe(202);
    expect(positive.cookies).toEqual([]);
    expect(positive.transportConstructions).toBe(0);
    expect(positive.providerRequests).toBe(1);
    expect(positive.dnsCalls + positive.netCalls + positive.tlsCalls).toBe(0);
    expect(positive.requestEvidence).toEqual([{
      url: 'https://api.resend.com/emails', method: 'POST', redirect: 'manual',
      contentType: 'application/json', authorizationPresent: true,
      idempotencyPresent: true, idempotencyLength: 96,
      from: 'NorthStar Notifications <notifications@northstar-os.ai>',
      normalizedRecipient: true, subject: 'Verify your NorthStar email',
      hasCanonicalTextLink: true, hasCanonicalHtmlLink: true,
      forbiddenFieldsAbsent: true,
      headerNames: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    }]);
    for (const relation of Object.keys(positive.before)) {
      expect(positive.after[relation] - positive.before[relation]).toBe(1);
    }
    expect(positive.authority).toEqual({
      state: 'pending_verification', trialStarted: false, trialEnds: false, sessionCount: 0,
    });

    const rejected = await runProductionCapabilityWorker(
      allocation.connectionString, valid, 'rejected-local-capture', true, 422
    );
    expect(rejected.status).toBe(503);
    expect(rejected.cookies).toEqual([]);
    expect(rejected.transportConstructions).toBe(0);
    expect(rejected.providerRequests).toBe(1);
    for (const relation of Object.keys(rejected.before)) {
      expect(rejected.after[relation] - rejected.before[relation]).toBe(1);
    }
    expect(rejected.authority).toEqual({
      state: 'pending_verification', trialStarted: false, trialEnds: false, sessionCount: 0,
    });
    expect(rejected.disclosure).toContain('verification_delivery_failed');
    expect(rejected.disclosure).not.toContain(valid.RESEND_API_KEY);
  }, 180000);

  test('pending user reads its tenant dashboard, opens/saves onboarding, and remains unverified', async () => {
    const created = await signup('pending-gates@example.test');
    expect(created.status).toBe(200);
    const jar = cookies(created);
    const headers = { Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf };

    const dashboard = await request(app).get('/api/v1/canonical/status').set(headers);
    expect(dashboard.status).toBe(200);
    const initial = await request(app).get('/api/v1/business-profile').set(headers);
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ success: true, onboardingDraft: true });
    expect(initial.body.data.company.email).toBe('pending-gates@example.test');

    const saved = await request(app).put('/api/v1/business-profile').set(headers)
      .send(canonicalFenceProfile({ companyName: 'Pending Gate Company' }));
    expect(saved.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set(headers);
    expect(me.status).toBe(200);
    expect(me.body.account.user.status).toBe('pending_verification');
    expect(me.body.account.onboarding.status).toBe('complete');

    const internal = await request(app).post('/api/v1/simulations/leads').set(headers).send({});
    expect(internal.status).toBe(403);
    expect(internal.body.code).toBe('product_access_required');

    const external = await request(app).put('/api/v1/canonical/integrations/retell').set(headers).send({
      externalIntegrationId: 'pending-must-not-bind', organizationId: crypto.randomUUID(), role: 'owner',
    });
    expect(external.status).toBe(403);
    expect(external.body.code).toBe('verification_required');
    const bound = await pool.query("SELECT count(*)::int AS count FROM canonical_integration_ownership WHERE external_integration_id = 'pending-must-not-bind'");
    expect(bound.rows[0].count).toBe(0);
  });

  test('verified incomplete user is directed by the onboarding gate while tenant reads remain available', async () => {
    const created = await signup('verified-incomplete@example.test');
    const jar = cookies(created);
    const headers = { Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf };
    await activateTrialForEmail('verified-incomplete@example.test');
    expect((await request(app).get('/api/v1/canonical/status').set(headers)).status).toBe(200);
    const denied = await request(app).post('/api/v1/voice/call').set(headers).send({ phoneNumber: '8605550103' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('onboarding_required');
  });

  test('verified completed authority is PostgreSQL-owned and ignores forged tenant/role fields', async () => {
    const created = await signup('verified-complete-gates@example.test');
    expect(created.status).toBe(200);
    const createdJar = cookies(created);
    const saved = await request(app).put('/api/v1/business-profile')
      .set({ Cookie: cookieHeader(createdJar), 'X-CSRF-Token': createdJar.northstar_csrf })
      .send(canonicalFenceProfile({ companyName: 'Verified Complete Gate Company' }));
    expect(saved.status).toBe(200);
    const user = await pool.query("SELECT id, organization_id FROM users WHERE email_normalized = 'verified-complete-gates@example.test'");
    expect(user.rows).toHaveLength(1);
    await activateTrialForEmail('verified-complete-gates@example.test');
    const login = await request(app).post('/api/auth/login').send({
      email: 'verified-complete-gates@example.test', password: 'durable gate password',
    });
    const jar = cookies(login);
    const externalId = `verified-${crypto.randomUUID()}`;
    const allowed = await request(app).put('/api/v1/canonical/integrations/retell')
      .set({ Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf })
      .send({ externalIntegrationId: externalId, organizationId: crypto.randomUUID(), role: 'owner' });
    expect(allowed.status).toBe(200);
    const stored = await pool.query(
      'SELECT organization_id FROM canonical_integration_ownership WHERE external_integration_id = $1',
      [externalId]
    );
    expect(stored.rows).toEqual([{ organization_id: user.rows[0].organization_id }]);
  });

  test('pending verification denies every mounted external family before provider or durable mutation', async () => {
    clearProviderSpies();
    const disclosure = `private-pending-${crypto.randomUUID()}`;
    const tenantPrivateMarker = `tenant-private-${crypto.randomUUID()}`;
    const foreignOrganizationId = crypto.randomUUID();
    const created = await signup('pending-external-families@example.test');
    expect(created.status).toBe(200);
    const jar = cookies(created);
    const headers = {
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': jar.northstar_csrf,
      'X-Organization-Id': foreignOrganizationId,
      'X-User-Role': 'owner',
    };
    const saved = await request(app).put('/api/v1/business-profile').set(headers)
      .send(canonicalFenceProfile({ companyName: tenantPrivateMarker }));
    expect(saved.status).toBe(200);
    const authority = await pool.query(
      "SELECT id, organization_id FROM users WHERE email_normalized = 'pending-external-families@example.test'"
    );
    expect(authority.rows).toHaveLength(1);
    const { id: userId, organization_id: organizationId } = authority.rows[0];
    const foreignTenant = await pool.query(
      'SELECT id, name FROM organizations WHERE id <> $1 ORDER BY created_at, id LIMIT 1',
      [organizationId]
    );
    expect(foreignTenant.rows).toHaveLength(1);
    const before = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_integration_ownership WHERE organization_id = $1) AS integrations,
         (SELECT count(*)::int FROM canonical_voice_sessions WHERE organization_id = $1) AS voice_sessions,
         (SELECT count(*)::int FROM canonical_voice_session_events WHERE organization_id = $1) AS voice_events`,
      [organizationId]
    );

    // Authenticated tenant reads and onboarding remain available while external actions are denied.
    expect((await request(app).get('/api/v1/canonical/status').set(headers)).status).toBe(200);
    expect((await request(app).get('/api/v1/business-profile').set(headers)).status).toBe(200);

    const querySpy = jest.spyOn(pool, 'query');
    const exported = await request(app).get('/api/leads/export')
      .set(headers).query({ organizationId: foreignOrganizationId, disclosure });
    const communication = await request(app).post('/api/communications').set(headers).send({
      organizationId: foreignOrganizationId, role: 'owner', message: disclosure,
    });
    const calendar = await request(app).post('/api/calendar/schedule').set(headers).send({
      organizationId: foreignOrganizationId, role: 'owner', leadId: disclosure, calendarId: disclosure,
    });
    const retellAgent = await request(app).post('/api/retell/create-agent').set(headers).send({
      organizationId: foreignOrganizationId, role: 'owner', name: disclosure, companyName: disclosure,
    });
    const retellSms = await request(app).post('/api/retell/send-sms').set(headers).send({
      organizationId: foreignOrganizationId, role: 'owner', phoneNumber: '8605550110', message: disclosure,
    });
    const jobberAuth = await request(app).get('/api/integrations/jobber/auth')
      .set(headers).query({ organizationId: foreignOrganizationId, role: 'owner', disclosure });
    const jobberCallback = await request(app).get('/api/integrations/jobber/callback')
      .set(headers).query({ code: disclosure, state: disclosure, organizationId: foreignOrganizationId });
    const integration = await request(app).put('/api/v1/canonical/integrations/retell').set(headers).send({
      externalIntegrationId: `pending-${disclosure}`,
      organizationId: foreignOrganizationId,
      role: 'owner',
      metadata: { disclosure },
    });
    const outboundVoice = await request(app).post('/api/v1/voice/call').set(headers).send({
      organizationId: foreignOrganizationId, role: 'owner', phoneNumber: '8605550111', caller: disclosure,
    });
    const handoff = await request(app).post(`/api/v1/voice/sessions/${disclosure}/handoff`)
      .set(headers).set('Idempotency-Key', `pending-handoff-${disclosure}`).send({ reason: disclosure });
    const cancel = await request(app).post(`/api/v1/voice/sessions/${disclosure}/cancel`)
      .set(headers).set('Idempotency-Key', `pending-cancel-${disclosure}`).send({ reason: disclosure });
    const writes = querySpy.mock.calls.filter(([statement]) => (
      /^(?:\s|\/\*[\s\S]*?\*\/)*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(String(statement))
    ));
    querySpy.mockRestore();

    for (const denied of [
      exported, retellAgent, retellSms, jobberAuth, jobberCallback, integration,
      outboundVoice, handoff, cancel,
    ]) {
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('verification_required');
    }
    // These two legacy mutations are supported only as explicitly retired contracts.
    for (const retired of [communication, calendar]) {
      expect(retired.status).toBe(409);
      expect(retired.body.error.code).toBe('LEGACY_AUTHORITY_READ_ONLY');
    }
    for (const response of [
      exported, communication, calendar, retellAgent, retellSms, jobberAuth,
      jobberCallback, integration, outboundVoice, handoff, cancel,
    ]) {
      expect(response.text).not.toContain(disclosure);
      expect(response.text).not.toContain(foreignOrganizationId);
      expect(response.text).not.toContain(tenantPrivateMarker);
      expect(response.text).not.toContain(organizationId);
      expect(response.text).not.toContain(userId);
      expect(response.text).not.toContain(foreignTenant.rows[0].id);
      expect(response.text).not.toContain(foreignTenant.rows[0].name);
    }
    expectNoProviderCalls();
    expect(writes).toEqual([]);
    const after = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_integration_ownership WHERE organization_id = $1) AS integrations,
         (SELECT count(*)::int FROM canonical_voice_sessions WHERE organization_id = $1) AS voice_sessions,
         (SELECT count(*)::int FROM canonical_voice_session_events WHERE organization_id = $1) AS voice_events`,
      [organizationId]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  }, 30000);

  test('expired organizations preserve reads and deny internal and external mutation families at shared boundaries', async () => {
    clearProviderSpies();
    const created = await signup('expired-mutation-families@example.test');
    const jar = cookies(created);
    const headers = { Cookie: cookieHeader(jar), 'X-CSRF-Token': jar.northstar_csrf };
    expect((await request(app).put('/api/v1/business-profile').set(headers)
      .send(canonicalFenceProfile({ companyName: 'Expired Mutation Company' }))).status).toBe(200);
    await activateTrialForEmail('expired-mutation-families@example.test');
    const authority = (await pool.query(
      "SELECT id, organization_id FROM users WHERE email_normalized = 'expired-mutation-families@example.test'"
    )).rows[0];
    await pool.query(
      `UPDATE subscriptions
          SET status = 'expired',
              trial_started_at = transaction_timestamp() - INTERVAL '15 days',
              trial_ends_at = transaction_timestamp() - INTERVAL '1 day'
        WHERE organization_id = $1`,
      [authority.organization_id]
    );
    expect((await request(app).get('/api/auth/me').set(headers)).status).toBe(200);
    expect((await request(app).get('/api/account/preferences').set(headers)).status).toBe(200);
    expect((await request(app).get('/api/v1/canonical/status').set(headers)).status).toBe(200);

    const marker = `expired-${crypto.randomUUID()}`;
    const querySpy = jest.spyOn(pool, 'query');
    const account = await request(app).put('/api/account/preferences').set(headers).send({ companyName: marker });
    const profile = await request(app).put('/api/v1/business-profile').set(headers)
      .send(canonicalFenceProfile({ companyName: marker }));
    const lead = await request(app).post('/api/leads').set(headers)
      .set('Idempotency-Key', marker).send({ customerName: marker, serviceKey: 'fence-installation' });
    const simulation = await request(app).post('/api/v1/simulations/leads').set(headers).send({ serviceKey: marker });
    const exported = await request(app).get('/api/leads/export').set(headers);
    const retellAgent = await request(app).post('/api/retell/create-agent').set(headers).send({ name: marker });
    const retellSms = await request(app).post('/api/retell/send-sms').set(headers)
      .send({ phoneNumber: '8605550188', message: marker });
    const jobber = await request(app).get('/api/integrations/jobber/auth').set(headers);
    const integration = await request(app).put('/api/v1/canonical/integrations/retell').set(headers)
      .send({ externalIntegrationId: marker });
    const outbound = await request(app).post('/api/v1/voice/call').set(headers)
      .send({ phoneNumber: '8605550189' });
    const handoff = await request(app).post(`/api/v1/voice/sessions/${marker}/handoff`).set(headers)
      .set('Idempotency-Key', `${marker}-handoff`).send({ reason: marker });
    const cancel = await request(app).post(`/api/v1/voice/sessions/${marker}/cancel`).set(headers)
      .set('Idempotency-Key', `${marker}-cancel`).send({ reason: marker });
    const writes = querySpy.mock.calls.filter(([statement]) => (
      /^(?:\s|\/\*[\s\S]*?\*\/)*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(String(statement))
    ));
    querySpy.mockRestore();

    for (const denied of [account, profile, exported, retellAgent, retellSms, jobber, integration, outbound, handoff, cancel]) {
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('subscription_read_only');
      expect(denied.text).not.toContain(marker);
    }
    for (const denied of [lead, simulation]) {
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('product_access_required');
      expect(denied.text).not.toContain(marker);
    }
    expectNoProviderCalls();
    expect(writes).toEqual([]);
    expect((await pool.query(
      `SELECT count(*)::int AS count FROM leads
        WHERE organization_id = $1 AND caller_name = $2`,
      [authority.organization_id, marker]
    )).rows[0].count).toBe(0);
  }, 30000);

  test('verified mounted families reach intercepted contracts with PostgreSQL-owned role and tenant', async () => {
    clearProviderSpies();
    const foreignOrganizationId = crypto.randomUUID();
    const created = await signup('verified-external-families@example.test');
    expect(created.status).toBe(200);
    const createdJar = cookies(created);
    const createdHeaders = {
      Cookie: cookieHeader(createdJar),
      'X-CSRF-Token': createdJar.northstar_csrf,
    };
    const saved = await request(app).put('/api/v1/business-profile').set(createdHeaders)
      .send(canonicalFenceProfile({ companyName: 'PostgreSQL External Authority Company' }));
    expect(saved.status).toBe(200);
    await activateTrialForEmail('verified-external-families@example.test');
    const ownExportMarker = `Own Tenant ${crypto.randomUUID()}`;
    const ownLead = await request(app).post('/api/leads').set(createdHeaders)
      .set('Idempotency-Key', `own-export-${crypto.randomUUID()}`)
      .send({ customerName: ownExportMarker, serviceKey: 'fence-installation' });
    expect(ownLead.status).toBe(201);

    const foreignCreated = await signup('foreign-export-scope@example.test');
    expect(foreignCreated.status).toBe(200);
    const foreignJar = cookies(foreignCreated);
    const foreignHeaders = {
      Cookie: cookieHeader(foreignJar),
      'X-CSRF-Token': foreignJar.northstar_csrf,
    };
    expect((await request(app).put('/api/v1/business-profile').set(foreignHeaders)
      .send(canonicalFenceProfile({ companyName: 'Foreign Export Scope Company' }))).status).toBe(200);
    await activateTrialForEmail('foreign-export-scope@example.test');
    const foreignExportMarker = `Foreign Tenant ${crypto.randomUUID()}`;
    const foreignLead = await request(app).post('/api/leads').set(foreignHeaders)
      .set('Idempotency-Key', `foreign-export-${crypto.randomUUID()}`)
      .send({ customerName: foreignExportMarker, serviceKey: 'fence-repair' });
    expect(foreignLead.status).toBe(201);
    const authority = await pool.query(
      `SELECT u.id, u.organization_id, m.id AS membership_id
         FROM users u
         JOIN organization_memberships m ON m.user_id = u.id AND m.organization_id = u.organization_id
        WHERE u.email_normalized = 'verified-external-families@example.test'`
    );
    expect(authority.rows).toHaveLength(1);
    const { id: userId, organization_id: organizationId, membership_id: membershipId } = authority.rows[0];
    await pool.query("UPDATE organization_memberships SET role = 'viewer' WHERE id = $1", [membershipId]);
    const login = await request(app).post('/api/auth/login').send({
      email: 'verified-external-families@example.test', password: 'durable gate password',
    });
    expect(login.status).toBe(200);
    const session = await pool.query(
      `SELECT id
         FROM auth_sessions
        WHERE user_id = $1 AND organization_id = $2 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, organizationId]
    );
    expect(session.rows).toHaveLength(1);
    const sessionId = session.rows[0].id;
    const jar = cookies(login);
    const headers = {
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': jar.northstar_csrf,
      'X-Organization-Id': foreignOrganizationId,
      'X-User-Role': 'owner',
    };

    const viewerDenied = await request(app).post('/api/retell/create-agent').set(headers).send({
      organizationId: foreignOrganizationId, role: 'owner', name: 'forged-owner-agent',
    });
    expect(viewerDenied.status).toBe(403);
    expect(viewerDenied.body).toMatchObject({
      error: 'Insufficient permissions',
      required: { resource: 'integrations', action: 'create' },
      role: 'viewer',
    });
    expect(providerSpies.retellAgent).not.toHaveBeenCalled();

    const viewerDenials = [
      {
        response: await request(app).post('/api/retell/send-sms').set(headers)
          .send({ phoneNumber: '8605550112', message: 'viewer must not send', role: 'owner' }),
        resource: 'calls', action: 'create',
      },
      {
        response: await request(app).get('/api/integrations/jobber/auth').set(headers)
          .query({ organizationId: foreignOrganizationId, role: 'owner' }),
        resource: 'integrations', action: 'update',
      },
      {
        response: await request(app).put('/api/v1/canonical/integrations/voice').set(headers)
          .send({ externalIntegrationId: `viewer-denied-${crypto.randomUUID()}`, role: 'owner' }),
        resource: 'integrations', action: 'update',
      },
      {
        response: await request(app).post('/api/v1/voice/call').set(headers)
          .send({ phoneNumber: '8605550113', role: 'owner' }),
        resource: 'calls', action: 'create',
      },
      {
        response: await request(app).post('/api/v1/voice/sessions/viewer-denied/handoff').set(headers)
          .set('Idempotency-Key', `viewer-handoff-${crypto.randomUUID()}`).send({ role: 'owner' }),
        resource: 'calls', action: 'update',
      },
      {
        response: await request(app).post('/api/v1/voice/sessions/viewer-denied/cancel').set(headers)
          .set('Idempotency-Key', `viewer-cancel-${crypto.randomUUID()}`).send({ role: 'owner' }),
        resource: 'calls', action: 'update',
      },
    ];
    for (const denied of viewerDenials) {
      expect(denied.response.status).toBe(403);
      expect(denied.response.body).toMatchObject({
        error: 'Insufficient permissions',
        required: { resource: denied.resource, action: denied.action },
        role: 'viewer',
      });
    }
    expectNoProviderCalls();

    // The same durable session reloads the current PostgreSQL membership on every request.
    await pool.query("UPDATE organization_memberships SET role = 'owner' WHERE id = $1", [membershipId]);
    headers['X-User-Role'] = 'viewer';
    const agent = await request(app).post('/api/retell/create-agent').set(headers).send({
      organizationId: foreignOrganizationId,
      role: 'viewer',
      name: 'Mounted intercepted agent',
      companyName: 'Request-provided provider label',
      services: 'fence installation',
    });
    expect(agent.status).toBe(200);
    expect(agent.body.canonicalOwnershipPersisted).toBe(true);
    expect(providerSpies.retellAgent).toHaveBeenCalledTimes(1);
    const retellExternalId = agent.body.agent_id;
    const retellOwnership = await pool.query(
      `SELECT organization_id, created_by, provider, external_integration_id
         FROM canonical_integration_ownership WHERE provider = 'retell' AND external_integration_id = $1`,
      [retellExternalId]
    );
    expect(retellOwnership.rows).toEqual([{
      organization_id: organizationId,
      created_by: userId,
      provider: 'retell',
      external_integration_id: retellExternalId,
    }]);

    const voiceIntegrationId = `intercepted-voice-${crypto.randomUUID()}`;
    const integration = await request(app).put('/api/v1/canonical/integrations/voice').set(headers).send({
      externalIntegrationId: voiceIntegrationId,
      organizationId: foreignOrganizationId,
      role: 'viewer',
      metadata: { synchronization: 'intercepted-test-boundary' },
    });
    expect(integration.status).toBe(200);
    const bound = await pool.query(
      `SELECT organization_id, created_by, provider, external_integration_id
         FROM canonical_integration_ownership WHERE provider = 'voice' AND external_integration_id = $1`,
      [voiceIntegrationId]
    );
    expect(bound.rows).toEqual([{
      organization_id: organizationId,
      created_by: userId,
      provider: 'voice',
      external_integration_id: voiceIntegrationId,
    }]);

    const exported = await request(app).get('/api/leads/export').set(headers)
      .query({ organizationId: foreignOrganizationId, role: 'viewer' });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toMatch(/^text\/csv/);
    expect(exported.text).toContain('customerId,customerName,phone,email,service,status,estimatedPrice');
    expect(exported.text).toContain(ownExportMarker);
    expect(exported.text).not.toContain(foreignExportMarker);

    const communication = await request(app).post('/api/communications').set(headers).send({
      organizationId: foreignOrganizationId, role: 'viewer', message: 'must remain retired',
    });
    const calendar = await request(app).post('/api/calendar/schedule').set(headers).send({
      organizationId: foreignOrganizationId, role: 'viewer', leadId: 'must-remain-retired',
    });
    for (const retired of [communication, calendar]) {
      expect(retired.status).toBe(409);
      expect(retired.body.error.code).toBe('LEGACY_AUTHORITY_READ_ONLY');
    }
    expect(providerSpies.calendarSchedule).not.toHaveBeenCalled();
    expect(providerSpies.emailNotification).not.toHaveBeenCalled();
    expect(providerSpies.smsNotification).not.toHaveBeenCalled();

    const sms = await request(app).post('/api/retell/send-sms').set(headers).send({
      organizationId: foreignOrganizationId,
      role: 'viewer',
      phoneNumber: '8605550112',
      message: 'intercepted mounted SMS',
    });
    expect(sms.status).toBe(200);
    expect(sms.body).toEqual({ success: true, intercepted: true });
    expect(providerSpies.retellSms).toHaveBeenCalledWith('8605550112', 'intercepted mounted SMS');

    const jobberAuth = await request(app).get('/api/integrations/jobber/auth').set(headers)
      .query({ organizationId: foreignOrganizationId, role: 'viewer' });
    expect(jobberAuth.status).toBe(302);
    const providerRedirect = new URL(jobberAuth.headers.location);
    expect(providerRedirect.origin).toBe('https://provider.invalid');
    const state = providerRedirect.searchParams.get('state');
    expect(state).toBeTruthy();
    const jobberCallback = await request(app).get('/api/integrations/jobber/callback').set(headers)
      .query({ code: 'intercepted-jobber-code', state, organizationId: foreignOrganizationId, role: 'viewer' });
    expect(jobberCallback.status).toBe(302);
    expect(jobberCallback.headers.location).toBe('/dashboard/integrations?jobber=connected');
    expect(providerSpies.jobberAuth).toHaveBeenCalledTimes(1);
    expect(providerSpies.jobberExchange).toHaveBeenCalledTimes(1);
    expect(providerSpies.jobberExchange.mock.calls[0][0]).toBe('intercepted-jobber-code');
    expect(providerSpies.jobberSave).toHaveBeenCalledWith({
      provider: 'jobber',
      organizationId,
      userId,
      sessionId,
      accessToken: 'intercepted-jobber-access',
      refreshToken: 'intercepted-jobber-refresh',
      expiresIn: 3600,
    });

    const outbound = await request(app).post('/api/v1/voice/call').set(headers).send({
      organizationId: foreignOrganizationId,
      role: 'viewer',
      phoneNumber: '8605550113',
      caller: 'Mounted intercepted caller',
      businessProfile: { organizationId: foreignOrganizationId },
    });
    expect(outbound.status).toBe(200);
    expect(outbound.body.success).toBe(true);
    expect(providerSpies.retellCall).toHaveBeenCalledTimes(1);
    const [providerPhone, providerAgentId, providerOptions] = providerSpies.retellCall.mock.calls[0];
    expect(providerPhone).toBe('8605550113');
    expect(providerAgentId).toBe(retellExternalId);
    expect(JSON.stringify(providerOptions.executiveContext)).not.toContain(foreignOrganizationId);
    expect(JSON.stringify(providerOptions.executiveContext)).toContain('PostgreSQL External Authority Company');
    const voiceSession = await pool.query(
      `SELECT organization_id, external_session_id, to_number, status
         FROM canonical_voice_sessions WHERE external_session_id = $1`,
      [outbound.body.callId]
    );
    expect(voiceSession.rows).toEqual([{
      organization_id: organizationId,
      external_session_id: outbound.body.callId,
      to_number: '8605550113',
      status: 'active',
    }]);

    // Test-only live-runtime provisioning; the mounted outbound call created the durable session above.
    const runtimeProvisioned = await pool.query(
      `UPDATE canonical_voice_sessions SET runtime_owner_id = $3
        WHERE organization_id = $1 AND external_session_id = $2 RETURNING id`,
      [organizationId, outbound.body.callId, voiceSessions.RUNTIME_OWNER_ID]
    );
    expect(runtimeProvisioned.rows).toHaveLength(1);
    const runtimeHandoff = jest.fn().mockResolvedValue(undefined);
    const runtimeCancel = jest.fn().mockResolvedValue(undefined);
    voiceSessions.registerRuntimeHandle(organizationId, outbound.body.callId, {
      handoff: runtimeHandoff,
      cancel: runtimeCancel,
    });
    const handoff = await request(app).post(`/api/v1/voice/sessions/${outbound.body.callId}/handoff`)
      .set(headers).set('Idempotency-Key', `handoff-${crypto.randomUUID()}`)
      .send({ organizationId: foreignOrganizationId, role: 'viewer', reason: 'mounted owner handoff' });
    expect(handoff.status).toBe(200);
    expect(handoff.body.session.status).toBe('escalating');
    const cancel = await request(app).post(`/api/v1/voice/sessions/${outbound.body.callId}/cancel`)
      .set(headers).set('Idempotency-Key', `cancel-${crypto.randomUUID()}`)
      .send({ organizationId: foreignOrganizationId, role: 'viewer', reason: 'mounted owner cancel' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.session.status).toBe('cancelled');
    expect(runtimeHandoff).toHaveBeenCalledWith('mounted owner handoff');
    expect(runtimeCancel).toHaveBeenCalledWith('mounted owner cancel');
    const events = await pool.query(
      `SELECT e.event_type
         FROM canonical_voice_session_events e
         JOIN canonical_voice_sessions s
           ON s.organization_id = e.organization_id AND s.id = e.voice_session_id
        WHERE s.organization_id = $1 AND s.external_session_id = $2`,
      [organizationId, outbound.body.callId]
    );
    expect(events.rows.map(row => row.event_type)).toEqual(expect.arrayContaining([
      'provider_creation_requested', 'call_started', 'human_handoff', 'call_cancelled',
    ]));

    expect(providerSpies.retellAgent).toHaveBeenCalledTimes(1);
    expect(providerSpies.retellSms).toHaveBeenCalledTimes(1);
    expect(providerSpies.retellCall).toHaveBeenCalledTimes(1);
    expect(providerSpies.jobberAuth).toHaveBeenCalledTimes(1);
    expect(providerSpies.jobberExchange).toHaveBeenCalledTimes(1);
    expect(providerSpies.jobberSave).toHaveBeenCalledTimes(1);
    expect(providerSpies.externalFetch).not.toHaveBeenCalled();
    expect(providerSpies.externalHttps).not.toHaveBeenCalled();
  }, 30000);

  test('Bearer is retired regardless of flags or forged claims and browser source never constructs it', async () => {
    const jar = cookies(await signup('bearer-retired-gates@example.test'));
    for (const token of [
      jar.northstar_access,
      jwt.sign({ sub: crypto.randomUUID(), sid: crypto.randomUUID(), role: 'owner', organizationId: crypto.randomUUID(), onboardingStatus: 'complete' }, process.env.AUTH_ACCESS_SECRET),
      'missing-session',
    ]) {
      const response = await request(app).get('/api/v1/canonical/status').set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('unauthorized');
    }
    const browser = fs.readFileSync(path.resolve(__dirname, '../../public/js/auth-session.js'), 'utf8');
    expect(browser).not.toMatch(/Authorization|Bearer/);
  });

  test('current membership and session revocation invalidate cookie authority immediately', async () => {
    const jar = cookies(await signup('revocation-gates@example.test'));
    const decoded = jwt.decode(jar.northstar_access);
    await pool.query("UPDATE organization_memberships SET status = 'suspended' WHERE user_id = $1", [decoded.sub]);
    const inactive = await request(app).get('/api/v1/canonical/status').set('Cookie', cookieHeader(jar));
    expect(inactive.status).toBe(403);
    expect(inactive.body.code).toBe('organization_membership_required');
    await pool.query("UPDATE organization_memberships SET status = 'active' WHERE user_id = $1", [decoded.sub]);
    await pool.query("UPDATE auth_sessions SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'test_revocation' WHERE id = $1", [decoded.sid]);
    const revoked = await request(app).get('/api/v1/canonical/status').set('Cookie', cookieHeader(jar));
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe('session_inactive');
  });

  test('public demo outbound action is retired before provider creation', async () => {
    const response = await request(app).post('/api/demo/call').send({ phoneNumber: '8605550199' });
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('demo_external_action_retired');
  });
});
