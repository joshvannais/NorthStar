'use strict';

const crypto = require('crypto');
const https = require('https');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '8a000000-0000-4000-8000-000000000001';
const ORG_B = '8a000000-0000-4000-8000-000000000002';
const OWNER_A = '8b000000-0000-4000-8000-000000000001';
const ADMIN_A = '8b000000-0000-4000-8000-000000000002';
const MEMBER_A = '8b000000-0000-4000-8000-000000000003';
const VIEWER_A = '8b000000-0000-4000-8000-000000000004';
const OWNER_B = '8b000000-0000-4000-8000-000000000005';
const LEGACY_GREETING = '  Account greeting <legacy>\r\nKeep e\u0301 bytes.  ';
const LEGACY_RETELL = Object.freeze({
  assistantName: 'Legacy exact assistant',
  voiceStyle: 'Legacy exact style',
  greetingTemplate: 'Legacy exact greeting',
  providerPrivateField: 'Legacy exact private bytes',
});

function voice(marker) {
  return {
    name: `  ${marker} <name> 🧭  `,
    style: `  ${marker} style\r\nKeep exact bytes.  `,
    greeting: `  ${marker} greeting e\u0301 <literal>.  `,
    personality: 'consultative',
    conversationStyle: 'warm',
    escalationRules: {
      rules: [
        { id: `${marker.toLowerCase()}-first`, enabled: true, when: `  ${marker} when\r\n<svg onload=never()>  `, action: 'transfer_if_available', fallbackAction: 'request_callback' },
        { id: `${marker.toLowerCase()}-second`, enabled: false, when: `  ${marker} fallback  `, action: 'take_message', fallbackAction: 'take_message' },
      ],
    },
  };
}

function profile(name) {
  const value = canonicalFenceProfile({ companyName: name });
  value.retell = { ...LEGACY_RETELL };
  return value;
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Phase 3A mounted AI configuration authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let db;
  let pool;
  let app;
  let sessions;
  let otherAuthority;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase3a-ai-configuration');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    const identity = (await pool.query("SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums")).rows[0];
    expect(identity.version).toBe('18.4');
    expect(identity.timezone).toBe('UTC');
    expect(identity.checksums).toBe('on');

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 3A Organization A','phase3a-a@example.test'),
       ($2,'Phase 3A Organization B','phase3a-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase3a.test`, role]
      );
    }
    await pool.query(
      `INSERT INTO notification_preferences (
         organization_id, email_new_lead, email_call_summary, email_appointment,
         sms_new_lead, sms_urgent, notification_email, notification_phone
       ) VALUES
       ($1,TRUE,FALSE,TRUE,FALSE,TRUE,'owner@example.test','+1 860 555 0100'),
       ($2,FALSE,TRUE,FALSE,TRUE,FALSE,'other@example.test','+1 212 555 0100')`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,jsonb_build_object('greeting',$3::text,'companyInfo','legacy account info')),
              ($2,'{}'::jsonb)`,
      [ORG_A, ORG_B, LEGACY_GREETING]
    );

    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: profile('Phase 3A Company') });
    otherAuthority = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: profile('Other Tenant') });

    sessions = {};
    for (const [role, userId, organizationId] of [
      ['owner', OWNER_A, ORG_A], ['admin', ADMIN_A, ORG_A], ['member', MEMBER_A, ORG_A],
      ['viewer', VIEWER_A, ORG_A], ['otherOwner', OWNER_B, ORG_B],
    ]) {
      sessions[role] = await provisionDurableSession(pool, { userId, organizationId, role: role === 'otherOwner' ? 'owner' : role });
    }
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
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

  test('only the exact versioned section write can change raw voice authority', async () => {
    const initial = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    expect(initial.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(initial.body.data, 'voiceAssistant')).toBe(false);
    const initialPricing = initial.body.data.canonicalPricing;
    const initialCosts = initial.body.data.canonicalCosts;

    const unrelatedWhole = JSON.parse(JSON.stringify(initial.body.data));
    unrelatedWhole.company.dba = 'Unrelated whole-profile save';
    unrelatedWhole.voiceAssistant = voice('Bypass');
    const wholeSaved = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send(unrelatedWhole);
    expect(wholeSaved.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(wholeSaved.body.data, 'voiceAssistant')).toBe(false);
    expect(wholeSaved.body.data.retell).toEqual(LEGACY_RETELL);

    const companySaved = await request(app).put('/api/v1/business-profile/company').set(sessions.owner.headers).send({
      ...wholeSaved.body.data.company, dba: 'Unrelated section save',
    });
    expect(companySaved.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(companySaved.body.data, 'voiceAssistant')).toBe(false);

    const firstVoice = voice('Owner');
    const ownerSaved = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.owner.headers).send({
      expectedVersion: companySaved.body.data.canonicalAuthority.version,
      value: firstVoice,
    });
    expect(ownerSaved.status).toBe(200);
    expect(ownerSaved.body.data.voiceAssistant).toEqual(firstVoice);

    const secondVoice = voice('Admin');
    const adminSaved = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.admin.headers).send({
      expectedVersion: ownerSaved.body.data.canonicalAuthority.version,
      value: secondVoice,
    });
    expect(adminSaved.status).toBe(200);
    expect(adminSaved.body.data.voiceAssistant).toEqual(secondVoice);

    const beforeStaleCount = (await pool.query('SELECT COUNT(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count;
    const stale = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.owner.headers).send({
      expectedVersion: ownerSaved.body.data.canonicalAuthority.version,
      value: voice('Stale'),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toEqual({ code: 'BUSINESS_PROFILE_VERSION_CONFLICT', message: 'Business Profile changed; reload and try again.' });
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeStaleCount);

    const currentVersion = adminSaved.body.data.canonicalAuthority.version;
    const concurrent = await Promise.all([
      request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.owner.headers).send({ expectedVersion: currentVersion, value: voice('RaceA') }),
      request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.admin.headers).send({ expectedVersion: currentVersion, value: voice('RaceB') }),
    ]);
    expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = concurrent.find(response => response.status === 200).body.data.voiceAssistant;
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeStaleCount + 1);

    const afterRace = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const staleWhole = JSON.parse(JSON.stringify(ownerSaved.body.data));
    staleWhole.company.dba = 'Stale non-voice client';
    staleWhole.voiceAssistant = voice('WholeBypass');
    const contained = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send(staleWhole);
    expect(contained.status).toBe(200);
    expect(contained.body.data.voiceAssistant).toEqual(winner);
    expect(contained.body.data.canonicalPricing).toEqual(initialPricing);
    expect(contained.body.data.canonicalCosts).toEqual(initialCosts);
    expect(contained.body.data.retell).toEqual(LEGACY_RETELL);
    expect(contained.body.data.canonicalAuthority.version).not.toBe(afterRace.body.data.canonicalAuthority.version);

    const bytes = (await pool.query(
      `SELECT encode(convert_to(raw_profile #>> '{voiceAssistant,name}', 'UTF8'), 'hex') AS name_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,style}', 'UTF8'), 'hex') AS style_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS greeting_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,escalationRules,rules,0,when}', 'UTF8'), 'hex') AS when_hex,
              raw_profile #> '{voiceAssistant,escalationRules,rules}' AS rules,
              raw_profile -> 'retell' AS retell
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    expect(bytes).toEqual({
      name_hex: hex(winner.name), style_hex: hex(winner.style), greeting_hex: hex(winner.greeting),
      when_hex: hex(winner.escalationRules.rules[0].when), rules: winner.escalationRules.rules, retell: LEGACY_RETELL,
    });
    expect((await pool.query('SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0].id).toBe(otherAuthority.id);
  }, 30000);

  test('strict envelope, nested validation, permissions, CSRF, and tenant isolation fail closed', async () => {
    const loaded = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const before = (await pool.query('SELECT id, version_label FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A])).rows[0];
    for (const body of [
      { value: {} },
      { expectedVersion: loaded.body.data.canonicalAuthority.version },
      { expectedVersion: loaded.body.data.canonicalAuthority.version, value: {}, extra: true },
      { expectedVersion: 'not-a-version', value: {} },
      { expectedVersion: loaded.body.data.canonicalAuthority.version, value: [] },
    ]) {
      const response = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.owner.headers).send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_VOICE_ASSISTANT_WRITE');
    }
    const invalidNested = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.owner.headers).send({
      expectedVersion: loaded.body.data.canonicalAuthority.version,
      value: { personality: 'impersonate-human', providerId: 'forbidden' },
    });
    expect(invalidNested.status).toBe(400);
    expect(invalidNested.body.error.code).toBe('INVALID_BUSINESS_PROFILE');
    expect(invalidNested.body.errors.join('\n')).toMatch(/personality|providerId/);

    for (const role of ['member', 'viewer']) {
      const denied = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions[role].headers).send({
        expectedVersion: loaded.body.data.canonicalAuthority.version, value: voice(role),
      });
      expect(denied.status).toBe(403);
    }
    expect((await request(app).put('/api/v1/business-profile/voiceAssistant').send({ expectedVersion: loaded.body.data.canonicalAuthority.version, value: {} })).status).toBe(401);
    const badCsrf = { ...sessions.owner.headers, 'X-CSRF-Token': 'forged-csrf' };
    expect((await request(app).put('/api/v1/business-profile/voiceAssistant').set(badCsrf).send({ expectedVersion: loaded.body.data.canonicalAuthority.version, value: {} })).status).toBe(403);
    expect((await pool.query('SELECT id, version_label FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A])).rows[0]).toEqual(before);
    expect((await pool.query('SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0].id).toBe(otherAuthority.id);
  });

  test('legacy Settings greeting remains byte-exact and cannot change canonical voice authority', async () => {
    const beforeProfile = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    const loaded = await request(app).get('/api/account/preferences').set(sessions.owner.headers);
    expect(loaded.status).toBe(200);
    expect(loaded.body.preferences.greeting).toBe(LEGACY_GREETING);
    const writable = { ...loaded.body.preferences, companyInfo: 'unrelated settings edit' };
    delete writable.securityEmailMandatory;
    delete writable.securityEmailAddress;
    const saved = await request(app).put('/api/account/preferences').set(sessions.owner.headers).send(writable);
    expect(saved.status).toBe(200);
    expect(saved.body.preferences.greeting).toBe(LEGACY_GREETING);
    const storedHex = (await pool.query(
      "SELECT encode(convert_to(preferences ->> 'greeting', 'UTF8'), 'hex') AS greeting_hex FROM organization_account_preferences WHERE organization_id = $1",
      [ORG_A]
    )).rows[0].greeting_hex;
    expect(storedHex).toBe(hex(LEGACY_GREETING));
    const afterProfile = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    expect(afterProfile.body.data.voiceAssistant).toEqual(beforeProfile.body.data.voiceAssistant);
    expect(afterProfile.body.data.canonicalAuthority.id).toBe(beforeProfile.body.data.canonicalAuthority.id);
  });

  test('retired request-body agent creation preserves gates and reaches no provider or persistence boundary', async () => {
    const retell = require('../../src/retell/client');
    const createAgent = jest.spyOn(retell, 'createAgent').mockImplementation(() => { throw new Error('provider boundary reached'); });
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn(() => { throw new Error('fetch boundary reached'); });
    global.fetch = fetchSpy;
    const httpsSpy = jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('https boundary reached'); });
    try {
      const beforeProfiles = (await pool.query('SELECT COUNT(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count;
      const beforeOwnership = (await pool.query('SELECT COUNT(*)::int AS count FROM canonical_integration_ownership WHERE organization_id = $1', [ORG_A])).rows[0].count;
      for (const role of ['owner', 'admin']) {
        const response = await request(app).post('/api/retell/create-agent').set(sessions[role].headers).send({
          name: 'request authority must not win', providerId: 'forbidden', organizationId: ORG_B,
        });
        expect(response.status).toBe(410);
        expect(response.body).toEqual({
          success: false,
          error: {
            code: 'LEGACY_PROVIDER_MUTATION_DISABLED',
            message: 'Request-body provider agent creation is disabled. Configure canonical Voice & Knowledge settings instead.',
          },
        });
      }
      for (const role of ['member', 'viewer']) {
        expect((await request(app).post('/api/retell/create-agent').set(sessions[role].headers).send({})).status).toBe(403);
      }
      expect(createAgent).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
      expect((await pool.query('SELECT COUNT(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeProfiles);
      expect((await pool.query('SELECT COUNT(*)::int AS count FROM canonical_integration_ownership WHERE organization_id = $1', [ORG_A])).rows[0].count).toBe(beforeOwnership);
    } finally {
      createAgent.mockRestore();
      httpsSpy.mockRestore();
      global.fetch = originalFetch;
    }
  });
});
