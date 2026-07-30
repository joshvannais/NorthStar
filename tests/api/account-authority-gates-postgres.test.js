'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
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
    ]) original[key] = process.env[key];
    process.env.DATABASE_URL = allocation.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.ACCOUNT_SIGNUP_ENABLED = 'true';
    process.env.ACCOUNT_VERIFICATION_DELIVERY_READY = 'true';
    process.env.AUTH_BEARER_COMPAT_ENABLED = 'true';
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    const calendar = require('../../src/calendar/client');
    const emailNotifications = require('../../src/notifications/email');
    const smsNotifications = require('../../src/notifications/sms');
    const retell = require('../../src/retell/client');
    const jobber = require('../../src/integrations/jobber');
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
      jobberSave: jest.spyOn(jobber, 'saveTokens').mockResolvedValue(undefined),
      externalFetch: jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected external fetch')),
      externalHttps: jest.spyOn(https, 'request').mockImplementation(() => {
        throw new Error('unexpected external HTTPS request');
      }),
    };
    app = require('../helpers/account-test-app').createDisposableAccountApp();
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
    return request(app).post('/api/auth/signup').send({
      name: 'Gate Owner', businessName: `Gate ${email}`, phone: '8605550101',
      email, password: 'durable gate password',
    });
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

  test('pending user reads its tenant dashboard, opens/saves onboarding, and remains unverified', async () => {
    const created = await signup('pending-gates@example.test');
    expect(created.status).toBe(201);
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
    expect(internal.status).toBe(422);
    expect(internal.body.error.code).toBe('service_required');

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
    const user = await pool.query("SELECT id FROM users WHERE email_normalized = 'verified-incomplete@example.test'");
    // Test provisioning only; this is not verification-flow evidence (PR B owns that flow).
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [user.rows[0].id]);
    expect((await request(app).get('/api/v1/canonical/status').set(headers)).status).toBe(200);
    const denied = await request(app).post('/api/v1/voice/call').set(headers).send({ phoneNumber: '8605550103' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('onboarding_required');
  });

  test('verified completed authority is PostgreSQL-owned and ignores forged tenant/role fields', async () => {
    const created = await signup('verified-complete-gates@example.test');
    expect(created.status).toBe(201);
    const createdJar = cookies(created);
    const saved = await request(app).put('/api/v1/business-profile')
      .set({ Cookie: cookieHeader(createdJar), 'X-CSRF-Token': createdJar.northstar_csrf })
      .send(canonicalFenceProfile({ companyName: 'Verified Complete Gate Company' }));
    expect(saved.status).toBe(200);
    const user = await pool.query("SELECT id, organization_id FROM users WHERE email_normalized = 'verified-complete-gates@example.test'");
    expect(user.rows).toHaveLength(1);
    // Test provisioning only; this is not verification-flow evidence (PR B owns that flow).
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [user.rows[0].id]);
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
    expect(created.status).toBe(201);
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

  test('verified mounted families reach intercepted contracts with PostgreSQL-owned role and tenant', async () => {
    clearProviderSpies();
    const foreignOrganizationId = crypto.randomUUID();
    const created = await signup('verified-external-families@example.test');
    expect(created.status).toBe(201);
    const createdJar = cookies(created);
    const createdHeaders = {
      Cookie: cookieHeader(createdJar),
      'X-CSRF-Token': createdJar.northstar_csrf,
    };
    const saved = await request(app).put('/api/v1/business-profile').set(createdHeaders)
      .send(canonicalFenceProfile({ companyName: 'PostgreSQL External Authority Company' }));
    expect(saved.status).toBe(200);
    const ownExportMarker = `Own Tenant ${crypto.randomUUID()}`;
    const ownLead = await request(app).post('/api/leads').set(createdHeaders)
      .set('Idempotency-Key', `own-export-${crypto.randomUUID()}`)
      .send({ customerName: ownExportMarker, serviceKey: 'fence-installation' });
    expect(ownLead.status).toBe(201);

    const foreignCreated = await signup('foreign-export-scope@example.test');
    expect(foreignCreated.status).toBe(201);
    const foreignJar = cookies(foreignCreated);
    const foreignHeaders = {
      Cookie: cookieHeader(foreignJar),
      'X-CSRF-Token': foreignJar.northstar_csrf,
    };
    expect((await request(app).put('/api/v1/business-profile').set(foreignHeaders)
      .send(canonicalFenceProfile({ companyName: 'Foreign Export Scope Company' }))).status).toBe(200);
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
    // Test provisioning only; this is not verification-flow evidence (PR B owns that flow).
    await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [userId]);
    await pool.query("UPDATE organization_memberships SET role = 'viewer' WHERE id = $1", [membershipId]);
    const login = await request(app).post('/api/auth/login').send({
      email: 'verified-external-families@example.test', password: 'durable gate password',
    });
    expect(login.status).toBe(200);
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
    expect(providerSpies.jobberSave).toHaveBeenCalledWith(
      userId, 'intercepted-jobber-access', 'intercepted-jobber-refresh', 3600
    );

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
