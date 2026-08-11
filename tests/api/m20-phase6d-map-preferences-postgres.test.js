'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '6e000000-0000-4000-8000-000000000001';
const ORG_B = '6e000000-0000-4000-8000-000000000002';
const OWNER_A = '6f000000-0000-4000-8000-000000000001';
const ADMIN_A = '6f000000-0000-4000-8000-000000000002';
const MEMBER_A = '6f000000-0000-4000-8000-000000000003';
const VIEWER_A = '6f000000-0000-4000-8000-000000000004';
const OWNER_B = '6f000000-0000-4000-8000-000000000005';

const ROLE_USERS = Object.freeze([
  ['owner', OWNER_A],
  ['admin', ADMIN_A],
  ['member', MEMBER_A],
  ['viewer', VIEWER_A],
]);

function preferenceDocument(input = {}) {
  const states = input.states || {};
  const provider = (key) => ({
    enabled: Object.prototype.hasOwnProperty.call(states[key] || {}, 'enabled')
      ? states[key].enabled : true,
    visible: Object.prototype.hasOwnProperty.call(states[key] || {}, 'visible')
      ? states[key].visible : true,
  });
  return {
    providers: {
      google_maps: provider('google_maps'),
      apple_maps: provider('apple_maps'),
      waze: provider('waze'),
    },
    defaultProvider: input.defaultProvider || 'google_maps',
  };
}

function changedDocument(defaultProvider) {
  return preferenceDocument({
    defaultProvider,
    states: {
      google_maps: { enabled: defaultProvider === 'google_maps', visible: true },
      apple_maps: { enabled: true, visible: false },
      waze: { enabled: true, visible: true },
    },
  });
}

function stableJson(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
}

async function protectedDigests(pool) {
  const definitions = {
    organization_account_preferences: 'organization_id',
    notification_preferences: 'organization_id',
    canonical_business_profiles: 'organization_id, id',
    canonical_integration_ownership: 'organization_id, provider, id',
    oauth_authorization_states: 'organization_id, id',
    integration_credentials: 'organization_id, provider',
  };
  const result = {};
  for (const [table, order] of Object.entries(definitions)) {
    const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
    result[table] = crypto.createHash('sha256').update(stableJson(rows), 'utf8').digest('hex');
  }
  return result;
}

function expectPreferenceShape(data) {
  expect(Object.keys(data)).toEqual([
    'authority', 'contractVersion', 'providers', 'organization',
    'user', 'effective', 'permissions',
  ]);
  expect(data.authority).toBe('canonical_map_preferences_v1');
  expect(data.contractVersion).toBe(1);
  expect(data.providers).toEqual([
    { key: 'google_maps', name: 'Google Maps' },
    { key: 'apple_maps', name: 'Apple Maps' },
    { key: 'waze', name: 'Waze' },
  ]);
}

realPostgres('Mission 20 Phase 6D mounted canonical map preferences', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let originalFetch;
  let db;
  let pool;
  let app;
  let auth;

  function mountedRepositoryApp(repositoryProvider) {
    const { createMapPreferencesRouter } = require('../../src/routes/mapPreferences');
    const mounted = express();
    mounted.use(express.json());
    mounted.use('/api/account/map-preferences', createMapPreferencesRouter({ repositoryProvider }));
    return mounted;
  }

  function projectionFailureHarness() {
    const { MapPreferencesRepository } = require('../../src/mapPreferences/repository');
    const repository = new MapPreferencesRepository(pool, {
      projector: () => { throw new Error('injected authoritative response projection failure'); },
    });
    let separateReadCalls = 0;
    const mounted = mountedRepositoryApp(() => ({
      read: async () => {
        separateReadCalls += 1;
        throw new Error('post-commit response read must be unreachable');
      },
      updateOrganization: input => repository.updateOrganization(input),
      updateUser: input => repository.updateUser(input),
    }));
    return { mounted, separateReadCalls: () => separateReadCalls };
  }

  function responseRaceHarness(operation) {
    const { MapPreferencesRepository } = require('../../src/mapPreferences/repository');
    const repository = new MapPreferencesRepository(pool);
    let mutationCount = 0;
    let readCalls = 0;
    let releaseFirstMutation;
    let releaseSecondMutation;
    const firstMutation = new Promise(resolve => { releaseFirstMutation = resolve; });
    const secondMutation = new Promise(resolve => { releaseSecondMutation = resolve; });

    async function tracked(method, input) {
      const result = await repository[method](input);
      mutationCount += 1;
      if (mutationCount === 1) releaseFirstMutation();
      if (mutationCount === 2) releaseSecondMutation();
      return result;
    }

    const mounted = mountedRepositoryApp(() => ({
      read: async (...args) => {
        readCalls += 1;
        if (readCalls === 1) await secondMutation;
        return repository.read(...args);
      },
      updateOrganization: input => operation === 'organization'
        ? tracked('updateOrganization', input)
        : repository.updateOrganization(input),
      updateUser: input => operation === 'user'
        ? tracked('updateUser', input)
        : repository.updateUser(input),
    }));
    return { mounted, firstMutation, readCalls: () => readCalls };
  }

  async function ensureStoredUserPreference(organizationId, userId) {
    await pool.query(
      `INSERT INTO user_map_preferences
         (organization_id, user_id, mode,
          google_maps_enabled, google_maps_visible,
          apple_maps_enabled, apple_maps_visible,
          waze_enabled, waze_visible, default_provider,
          version, updated_by_user_id)
       VALUES ($1,$2,'override',TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,'google_maps',1,$2)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [organizationId, userId]
    );
    return (await pool.query(
      `SELECT version, default_provider FROM user_map_preferences
        WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    )).rows[0];
  }

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase6d-map-preferences');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
      'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
    ]) delete process.env[name];

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    expect((await pool.query('SHOW server_version')).rows[0].server_version).toMatch(/^18\.4(?:\D|$)/);
    expect((await pool.query('SHOW timezone')).rows[0].TimeZone).toBe('UTC');
    expect((await pool.query('SHOW data_checksums')).rows[0].data_checksums).toBe('on');

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1,'Map Organization A','map-a@example.test'),
        ($2,'Map Organization B','map-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [role, userId, organizationId] of [
      ...ROLE_USERS.map(([role, userId]) => [role, userId, ORG_A]),
      ['owner', OWNER_B, ORG_B],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, `${role} map user`, `${userId}@phase6d.test`, role]
      );
    }
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences) VALUES
        ($1,'{"private":"ORG A RAW Ω <img src=x onerror=never()>"}'::jsonb),
        ($2,'{"private":"ORG B RAW"}'::jsonb)`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO notification_preferences
         (organization_id, notification_email, notification_phone, email_new_lead, sms_new_lead)
       VALUES ($1,'map-private-a@example.test','+15555550601',TRUE,TRUE),
              ($2,'map-private-b@example.test','+15555550602',TRUE,FALSE)`,
      [ORG_A, ORG_B]
    );

    auth = new Map();
    for (const [role, userId] of ROLE_USERS) {
      auth.set(userId, await provisionDurableSession(pool, { userId, organizationId: ORG_A, role }));
    }
    auth.set(OWNER_B, await provisionDurableSession(pool, {
      userId: OWNER_B, organizationId: ORG_B, role: 'owner',
    }));

    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('provider boundary must remain unused'); });
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalAccessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
      else process.env.AUTH_ACCESS_SECRET = originalAccessSecret;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('migration creates one deterministic organization authority for existing and future tenants', async () => {
    const rows = (await pool.query(
      `SELECT organization_id, google_maps_enabled, google_maps_visible,
              apple_maps_enabled, apple_maps_visible, waze_enabled, waze_visible,
              default_provider, version, authority_source, updated_by_user_id
         FROM organization_map_preferences
        WHERE organization_id IN ($1,$2)
        ORDER BY organization_id`,
      [ORG_A, ORG_B]
    )).rows;
    expect(rows).toEqual([
      {
        organization_id: ORG_A,
        google_maps_enabled: true, google_maps_visible: true,
        apple_maps_enabled: true, apple_maps_visible: true,
        waze_enabled: true, waze_visible: true,
        default_provider: 'google_maps', version: '1',
        authority_source: 'system_default', updated_by_user_id: null,
      },
      {
        organization_id: ORG_B,
        google_maps_enabled: true, google_maps_visible: true,
        apple_maps_enabled: true, apple_maps_visible: true,
        waze_enabled: true, waze_visible: true,
        default_provider: 'google_maps', version: '1',
        authority_source: 'system_default', updated_by_user_id: null,
      },
    ]);
  });

  test('all roles read only their tenant and receive truthful inheritance and role capabilities', async () => {
    const before = await protectedDigests(pool);
    for (const [role, userId] of ROLE_USERS) {
      const response = await request(app)
        .get('/api/account/map-preferences')
        .query({ organizationId: ORG_B, tenantId: ORG_B, userId: OWNER_B })
        .set(auth.get(userId).headers)
        .send({ organizationId: ORG_B, userId: OWNER_B });
      expect(response.status).toBe(200);
      expect(Object.keys(response.body)).toEqual(['success', 'data', 'requestId']);
      expect(response.body.success).toBe(true);
      expectPreferenceShape(response.body.data);
      expect(response.body.data.organization).toMatchObject({ version: 1, source: 'system_default' });
      expect(response.body.data.user).toEqual({
        version: 0, mode: 'inherit', hasStoredAuthority: false,
        preferences: null, updatedAt: null,
      });
      expect(response.body.data.effective).toMatchObject({
        source: 'organization', inheritsOrganization: true,
        organizationVersion: 1, userVersion: 0,
      });
      expect(response.body.data.permissions).toEqual({
        canUpdateOrganization: role === 'owner' || role === 'admin',
        canUpdateSelf: true,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/ORG [AB] RAW|map-private|\+155555506|organization-a|organization-b/i);
    }
    const tenantB = await request(app).get('/api/account/map-preferences').set(auth.get(OWNER_B).headers);
    expect(tenantB.status).toBe(200);
    expect(tenantB.body.data.organization.version).toBe(1);
    expect(await protectedDigests(pool)).toEqual(before);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('organization writes preserve role, CSRF, validation, no-op, and stale-version boundaries', async () => {
    const document = changedDocument('apple_maps');
    expect((await request(app).put('/api/account/map-preferences/organization')
      .set(auth.get(MEMBER_A).headers).send({ expectedVersion: 1, preferences: document })).status).toBe(403);
    expect((await request(app).put('/api/account/map-preferences/organization')
      .set(auth.get(VIEWER_A).headers).send({ expectedVersion: 1, preferences: document })).status).toBe(403);
    expect((await request(app).put('/api/account/map-preferences/organization')
      .set('Cookie', auth.get(OWNER_A).headers.Cookie)
      .send({ expectedVersion: 1, preferences: document })).status).toBe(403);

    const saved = await request(app).put('/api/account/map-preferences/organization')
      .set(auth.get(ADMIN_A).headers).send({ expectedVersion: 1, preferences: document });
    expect(saved.status).toBe(200);
    expect(saved.body.changed).toBe(true);
    expect(saved.body.data.organization).toMatchObject({ version: 2, preferences: document, source: 'user' });
    expect(saved.body.data.effective.preferences).toEqual(document);

    const noOp = await request(app).put('/api/account/map-preferences/organization')
      .set(auth.get(OWNER_A).headers).send({ expectedVersion: 2, preferences: document });
    expect(noOp.status).toBe(200);
    expect(noOp.body.changed).toBe(false);
    expect(noOp.body.data.organization.version).toBe(2);

    const stale = await request(app).put('/api/account/map-preferences/organization')
      .set(auth.get(OWNER_A).headers).send({ expectedVersion: 1, preferences: preferenceDocument() });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('MAP_PREFERENCES_VERSION_CONFLICT');

    for (const invalid of [
      { expectedVersion: 2, preferences: preferenceDocument({
        defaultProvider: 'google_maps',
        states: { google_maps: { enabled: false, visible: true } },
      }) },
      { expectedVersion: 2, preferences: preferenceDocument({
        states: {
          google_maps: { enabled: false }, apple_maps: { enabled: false }, waze: { enabled: false },
        },
      }) },
      { expectedVersion: 2, preferences: document, organizationId: ORG_B },
      { expectedVersion: 2, preferences: { ...document, defaultProvider: '<img src=x onerror=never()>' } },
    ]) {
      const response = await request(app).put('/api/account/map-preferences/organization')
        .set(auth.get(OWNER_A).headers).send(invalid);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MAP_PREFERENCES_INVALID');
    }
    expect((await pool.query(
      'SELECT version, default_provider FROM organization_map_preferences WHERE organization_id = $1', [ORG_A]
    )).rows[0]).toEqual({ version: '2', default_provider: 'apple_maps' });
  });

  test('concurrent organization writes serialize with one winner and no lost update', async () => {
    const google = preferenceDocument();
    const waze = changedDocument('waze');
    const [first, second] = await Promise.all([
      request(app).put('/api/account/map-preferences/organization')
        .set(auth.get(OWNER_A).headers).send({ expectedVersion: 2, preferences: google }),
      request(app).put('/api/account/map-preferences/organization')
        .set(auth.get(ADMIN_A).headers).send({ expectedVersion: 2, preferences: waze }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    expect(winner.body.changed).toBe(true);
    expect(winner.body.data.organization.version).toBe(3);
    const stored = (await pool.query(
      `SELECT version, default_provider, google_maps_enabled, apple_maps_enabled, waze_enabled
         FROM organization_map_preferences WHERE organization_id = $1`, [ORG_A]
    )).rows[0];
    expect(stored.version).toBe('3');
    expect(stored.default_provider).toBe(winner.body.data.organization.preferences.defaultProvider);
  });

  test('every role may write only its own complete override and retain versioned inheritance', async () => {
    const expectedEffectiveOrganizationVersion = 3;
    for (const [index, [role, userId]] of ROLE_USERS.entries()) {
      const defaultProvider = index % 2 === 0 ? 'apple_maps' : 'waze';
      const document = changedDocument(defaultProvider);
      const response = await request(app).put('/api/account/map-preferences/me')
        .set(auth.get(userId).headers)
        .send({ expectedVersion: 0, mode: 'override', preferences: document });
      expect(response.status).toBe(200);
      expect(response.body.changed).toBe(true);
      expect(response.body.data.user).toMatchObject({
        version: 1, mode: 'override', hasStoredAuthority: true, preferences: document,
      });
      expect(response.body.data.effective).toMatchObject({
        source: 'user_override', inheritsOrganization: false,
        organizationVersion: expectedEffectiveOrganizationVersion, userVersion: 1,
      });
      expect(response.body.data.permissions).toEqual({
        canUpdateOrganization: role === 'owner' || role === 'admin', canUpdateSelf: true,
      });
    }

    const targetAttempt = await request(app).put('/api/account/map-preferences/me')
      .set(auth.get(OWNER_A).headers)
      .send({ expectedVersion: 1, mode: 'override', preferences: preferenceDocument(), userId: VIEWER_A });
    expect(targetAttempt.status).toBe(400);
    expect(targetAttempt.body.error.code).toBe('MAP_PREFERENCES_INVALID');

    const beforeOther = (await pool.query(
      `SELECT default_provider, version FROM user_map_preferences
        WHERE organization_id = $1 AND user_id = $2`, [ORG_A, MEMBER_A]
    )).rows[0];
    const inherit = await request(app).put('/api/account/map-preferences/me')
      .set(auth.get(VIEWER_A).headers).send({ expectedVersion: 1, mode: 'inherit' });
    expect(inherit.status).toBe(200);
    expect(inherit.body.changed).toBe(true);
    expect(inherit.body.data.user).toEqual(expect.objectContaining({
      version: 2, mode: 'inherit', hasStoredAuthority: true, preferences: null,
    }));
    expect(inherit.body.data.effective).toMatchObject({
      source: 'organization', inheritsOrganization: true, userVersion: 2,
    });
    const noOp = await request(app).put('/api/account/map-preferences/me')
      .set(auth.get(VIEWER_A).headers).send({ expectedVersion: 2, mode: 'inherit' });
    expect(noOp.status).toBe(200);
    expect(noOp.body.changed).toBe(false);
    expect(noOp.body.data.user.version).toBe(2);
    const stale = await request(app).put('/api/account/map-preferences/me')
      .set(auth.get(VIEWER_A).headers).send({ expectedVersion: 1, mode: 'inherit' });
    expect(stale.status).toBe(409);
    expect((await pool.query(
      `SELECT default_provider, version FROM user_map_preferences
        WHERE organization_id = $1 AND user_id = $2`, [ORG_A, MEMBER_A]
    )).rows[0]).toEqual(beforeOther);
  });

  test('same-user concurrent writes have one winner and raw columns retain the exact accepted state', async () => {
    const ownerOverride = (await pool.query(
      'SELECT version FROM user_map_preferences WHERE organization_id = $1 AND user_id = $2', [ORG_A, OWNER_A]
    )).rows[0];
    const google = preferenceDocument({
      states: {
        google_maps: { enabled: true, visible: false },
        apple_maps: { enabled: false, visible: true },
        waze: { enabled: false, visible: false },
      },
    });
    const waze = preferenceDocument({
      defaultProvider: 'waze',
      states: {
        google_maps: { enabled: false, visible: true },
        apple_maps: { enabled: false, visible: false },
        waze: { enabled: true, visible: false },
      },
    });
    const [first, second] = await Promise.all([
      request(app).put('/api/account/map-preferences/me').set(auth.get(OWNER_A).headers)
        .send({ expectedVersion: Number(ownerOverride.version), mode: 'override', preferences: google }),
      request(app).put('/api/account/map-preferences/me').set(auth.get(OWNER_A).headers)
        .send({ expectedVersion: Number(ownerOverride.version), mode: 'override', preferences: waze }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const stored = (await pool.query(
      `SELECT mode, google_maps_enabled, google_maps_visible,
              apple_maps_enabled, apple_maps_visible, waze_enabled, waze_visible,
              default_provider, version, updated_by_user_id
         FROM user_map_preferences WHERE organization_id = $1 AND user_id = $2`,
      [ORG_A, OWNER_A]
    )).rows[0];
    const accepted = winner.body.data.user.preferences;
    expect(stored).toEqual({
      mode: 'override',
      google_maps_enabled: accepted.providers.google_maps.enabled,
      google_maps_visible: accepted.providers.google_maps.visible,
      apple_maps_enabled: accepted.providers.apple_maps.enabled,
      apple_maps_visible: accepted.providers.apple_maps.visible,
      waze_enabled: accepted.providers.waze.enabled,
      waze_visible: accepted.providers.waze.visible,
      default_provider: accepted.defaultProvider,
      version: String(Number(ownerOverride.version) + 1),
      updated_by_user_id: OWNER_A,
    });
  });

  test('authentication, malformed input, missing authority, and persistence failure fail closed', async () => {
    expect((await request(app).get('/api/account/map-preferences')).status).toBe(401);
    expect((await request(app).put('/api/account/map-preferences/me')
      .send({ expectedVersion: 0, mode: 'inherit' })).status).toBe(401);
    expect((await request(app).put('/api/account/map-preferences/me')
      .set(auth.get(MEMBER_A).headers)
      .send({ expectedVersion: Number.MAX_SAFE_INTEGER + 1, mode: 'inherit' })).status).toBe(400);

    const before = await protectedDigests(pool);
    const { createMapPreferencesRouter } = require('../../src/routes/mapPreferences');
    const failingApp = express();
    failingApp.use(express.json());
    failingApp.use('/api/account/map-preferences', createMapPreferencesRouter({
      repositoryProvider: () => ({
        read: async () => { throw new Error('disposable read outage'); },
        updateOrganization: async () => { throw new Error('disposable write outage'); },
        updateUser: async () => { throw new Error('disposable write outage'); },
      }),
    }));
    const read = await request(failingApp).get('/api/account/map-preferences').set(auth.get(OWNER_A).headers);
    expect(read.status).toBe(503);
    expect(read.body.error.code).toBe('MAP_PREFERENCES_UNAVAILABLE');
    const write = await request(failingApp).put('/api/account/map-preferences/organization')
      .set(auth.get(OWNER_A).headers)
      .send({ expectedVersion: 3, preferences: preferenceDocument() });
    expect(write.status).toBe(503);
    expect(write.body.error.code).toBe('MAP_PREFERENCES_UNAVAILABLE');
    expect(await protectedDigests(pool)).toEqual(before);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('map preferences never alter Phase 6C catalogue or legacy status bytes', async () => {
    const catalogueBefore = await request(app).get('/api/v1/integrations/catalogue').set(auth.get(OWNER_A).headers);
    const statusBefore = await request(app).get('/api/v1/integrations/status').set(auth.get(OWNER_A).headers);
    const preference = await request(app).put('/api/account/map-preferences/me')
      .set(auth.get(MEMBER_A).headers).send({ expectedVersion: 1, mode: 'inherit' });
    expect(preference.status).toBe(200);
    const catalogueAfter = await request(app).get('/api/v1/integrations/catalogue').set(auth.get(OWNER_A).headers);
    const statusAfter = await request(app).get('/api/v1/integrations/status').set(auth.get(OWNER_A).headers);
    expect(JSON.stringify(catalogueAfter.body.data)).toBe(JSON.stringify(catalogueBefore.body.data));
    expect(JSON.stringify(statusAfter.body.data)).toBe(JSON.stringify(statusBefore.body.data));
    expect(JSON.stringify(catalogueAfter.body.data)).not.toMatch(/mapPreferences|defaultProvider|enabled|visible/);
  });

  test('organization projection failure rolls back the mutation before any response read', async () => {
    const before = (await pool.query(
      'SELECT * FROM organization_map_preferences WHERE organization_id = $1', [ORG_A]
    )).rows[0];
    const document = changedDocument(before.default_provider === 'waze' ? 'apple_maps' : 'waze');
    const harness = projectionFailureHarness();
    const response = await request(harness.mounted)
      .put('/api/account/map-preferences/organization')
      .set(auth.get(OWNER_A).headers)
      .send({ expectedVersion: Number(before.version), preferences: document });
    const after = (await pool.query(
      'SELECT * FROM organization_map_preferences WHERE organization_id = $1', [ORG_A]
    )).rows[0];
    const observed = await request(app).get('/api/account/map-preferences').set(auth.get(OWNER_A).headers);
    expect({
      status: response.status,
      code: response.body.error && response.body.error.code,
      separateReadCalls: harness.separateReadCalls(),
      durableBytesUnchanged: stableJson(after) === stableJson(before),
      observedVersion: observed.body.data.organization.version,
    }).toEqual({
      status: 503,
      code: 'MAP_PREFERENCES_UNAVAILABLE',
      separateReadCalls: 0,
      durableBytesUnchanged: true,
      observedVersion: Number(before.version),
    });
  });

  test('self projection failure rolls back first-row insertion before any response read', async () => {
    await pool.query(
      'DELETE FROM user_map_preferences WHERE organization_id = $1 AND user_id = $2',
      [ORG_A, ADMIN_A]
    );
    const before = (await pool.query(
      'SELECT * FROM user_map_preferences WHERE organization_id = $1 AND user_id = $2',
      [ORG_A, ADMIN_A]
    )).rows;
    const harness = projectionFailureHarness();
    const response = await request(harness.mounted)
      .put('/api/account/map-preferences/me')
      .set(auth.get(ADMIN_A).headers)
      .send({ expectedVersion: 0, mode: 'override', preferences: changedDocument('apple_maps') });
    const after = (await pool.query(
      'SELECT * FROM user_map_preferences WHERE organization_id = $1 AND user_id = $2',
      [ORG_A, ADMIN_A]
    )).rows;
    const observed = await request(app).get('/api/account/map-preferences').set(auth.get(ADMIN_A).headers);
    expect({
      status: response.status,
      code: response.body.error && response.body.error.code,
      separateReadCalls: harness.separateReadCalls(),
      durableBytesUnchanged: stableJson(after) === stableJson(before),
      observedUser: observed.body.data.user,
    }).toEqual({
      status: 503,
      code: 'MAP_PREFERENCES_UNAVAILABLE',
      separateReadCalls: 0,
      durableBytesUnchanged: true,
      observedUser: {
        version: 0, mode: 'inherit', hasStoredAuthority: false,
        preferences: null, updatedAt: null,
      },
    });
  });

  test('first-row self insertion race has one exact winner and one stale response', async () => {
    const apple = changedDocument('apple_maps');
    const waze = changedDocument('waze');
    const [first, second] = await Promise.all([
      request(app).put('/api/account/map-preferences/me').set(auth.get(OWNER_B).headers)
        .send({ expectedVersion: 0, mode: 'override', preferences: apple }),
      request(app).put('/api/account/map-preferences/me').set(auth.get(OWNER_B).headers)
        .send({ expectedVersion: 0, mode: 'override', preferences: waze }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    expect(winner.body).toMatchObject({ success: true, changed: true });
    expect(winner.body.data.user).toMatchObject({ version: 1, mode: 'override' });
    const stored = (await pool.query(
      `SELECT version, default_provider FROM user_map_preferences
        WHERE organization_id = $1 AND user_id = $2`, [ORG_B, OWNER_B]
    )).rows[0];
    expect(stored).toEqual({
      version: '1',
      default_provider: winner.body.data.user.preferences.defaultProvider,
    });
  });

  test('organization responses remain bound to each accepted write under deterministic concurrency', async () => {
    const before = (await pool.query(
      'SELECT version, default_provider FROM organization_map_preferences WHERE organization_id = $1', [ORG_A]
    )).rows[0];
    const defaults = ['google_maps', 'apple_maps', 'waze'].filter(value => value !== before.default_provider);
    const firstDocument = changedDocument(defaults[0]);
    const secondDocument = changedDocument(defaults[1]);
    const harness = responseRaceHarness('organization');
    const firstPromise = request(harness.mounted)
      .put('/api/account/map-preferences/organization')
      .set(auth.get(OWNER_A).headers)
      .send({ expectedVersion: Number(before.version), preferences: firstDocument })
      .then(response => response);
    await harness.firstMutation;
    const secondPromise = request(harness.mounted)
      .put('/api/account/map-preferences/organization')
      .set(auth.get(ADMIN_A).headers)
      .send({ expectedVersion: Number(before.version) + 1, preferences: secondDocument })
      .then(response => response);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const stored = (await pool.query(
      'SELECT version, default_provider FROM organization_map_preferences WHERE organization_id = $1', [ORG_A]
    )).rows[0];
    expect({
      readCalls: harness.readCalls(),
      first: {
        status: first.status, changed: first.body.changed,
        version: first.body.data.organization.version,
        defaultProvider: first.body.data.organization.preferences.defaultProvider,
      },
      second: {
        status: second.status, changed: second.body.changed,
        version: second.body.data.organization.version,
        defaultProvider: second.body.data.organization.preferences.defaultProvider,
      },
      stored,
    }).toEqual({
      readCalls: 0,
      first: {
        status: 200, changed: true,
        version: Number(before.version) + 1, defaultProvider: firstDocument.defaultProvider,
      },
      second: {
        status: 200, changed: true,
        version: Number(before.version) + 2, defaultProvider: secondDocument.defaultProvider,
      },
      stored: { version: String(Number(before.version) + 2), default_provider: secondDocument.defaultProvider },
    });
  });

  test('self responses remain bound to each accepted write under deterministic concurrency', async () => {
    const before = await ensureStoredUserPreference(ORG_B, OWNER_B);
    const defaults = ['google_maps', 'apple_maps', 'waze'].filter(value => value !== before.default_provider);
    const firstDocument = changedDocument(defaults[0]);
    const secondDocument = changedDocument(defaults[1]);
    const harness = responseRaceHarness('user');
    const firstPromise = request(harness.mounted)
      .put('/api/account/map-preferences/me')
      .set(auth.get(OWNER_B).headers)
      .send({ expectedVersion: Number(before.version), mode: 'override', preferences: firstDocument })
      .then(response => response);
    await harness.firstMutation;
    const secondPromise = request(harness.mounted)
      .put('/api/account/map-preferences/me')
      .set(auth.get(OWNER_B).headers)
      .send({ expectedVersion: Number(before.version) + 1, mode: 'override', preferences: secondDocument })
      .then(response => response);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const stored = (await pool.query(
      `SELECT version, default_provider FROM user_map_preferences
        WHERE organization_id = $1 AND user_id = $2`, [ORG_B, OWNER_B]
    )).rows[0];
    expect({
      readCalls: harness.readCalls(),
      first: {
        status: first.status, changed: first.body.changed,
        version: first.body.data.user.version,
        defaultProvider: first.body.data.user.preferences.defaultProvider,
      },
      second: {
        status: second.status, changed: second.body.changed,
        version: second.body.data.user.version,
        defaultProvider: second.body.data.user.preferences.defaultProvider,
      },
      stored,
    }).toEqual({
      readCalls: 0,
      first: {
        status: 200, changed: true,
        version: Number(before.version) + 1, defaultProvider: firstDocument.defaultProvider,
      },
      second: {
        status: 200, changed: true,
        version: Number(before.version) + 2, defaultProvider: secondDocument.defaultProvider,
      },
      stored: { version: String(Number(before.version) + 2), default_provider: secondDocument.defaultProvider },
    });
  });

  test('organization and self writes preserve lock order and their own projections when concurrent', async () => {
    const organizationBefore = (await pool.query(
      'SELECT version, default_provider FROM organization_map_preferences WHERE organization_id = $1', [ORG_A]
    )).rows[0];
    const userBefore = await ensureStoredUserPreference(ORG_A, OWNER_A);
    const organizationDocument = changedDocument(
      organizationBefore.default_provider === 'waze' ? 'apple_maps' : 'waze'
    );
    const userDocument = changedDocument(userBefore.default_provider === 'google_maps' ? 'apple_maps' : 'google_maps');
    const [organizationResponse, userResponse] = await Promise.all([
      request(app).put('/api/account/map-preferences/organization').set(auth.get(OWNER_A).headers)
        .send({ expectedVersion: Number(organizationBefore.version), preferences: organizationDocument }),
      request(app).put('/api/account/map-preferences/me').set(auth.get(OWNER_A).headers)
        .send({ expectedVersion: Number(userBefore.version), mode: 'override', preferences: userDocument }),
    ]);
    expect(organizationResponse.status).toBe(200);
    expect(userResponse.status).toBe(200);
    expect(organizationResponse.body).toMatchObject({ success: true, changed: true });
    expect(userResponse.body).toMatchObject({ success: true, changed: true });
    expect(organizationResponse.body.data.organization).toMatchObject({
      version: Number(organizationBefore.version) + 1,
      preferences: organizationDocument,
    });
    expect(userResponse.body.data.user).toMatchObject({
      version: Number(userBefore.version) + 1,
      preferences: userDocument,
    });
  });
});
