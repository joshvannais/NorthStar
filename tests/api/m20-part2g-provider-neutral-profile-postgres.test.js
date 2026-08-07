'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '87000000-0000-4000-8000-000000000001';
const ORG_B = '87000000-0000-4000-8000-000000000002';
const OWNER_A = '88000000-0000-4000-8000-000000000001';
const VIEWER_A = '88000000-0000-4000-8000-000000000002';
const OWNER_B = '88000000-0000-4000-8000-000000000003';

const RAW = Object.freeze({
  industry: '  Home services <industry> 🏠  ',
  ownerName: '  Owner </input><svg onload=never()> 🧱  ',
  businessDescription: '\n  Provider-neutral description e\u0301 <literal>.  \n',
  emergencyPolicy: '  Human confirmation is required.\r\nNo arrival promise.  ',
  faq: [
    '  Q: Are estimates final?\nA: Written scope controls.  ',
    '  <img src=x onerror=never()> is literal data.  ',
  ],
  companyValues: ['  Accuracy  ', '  Safety & care <literal>  '],
  customPrompt: '  Use verified facts only.\r\nPreserve whitespace.  ',
  voiceAssistant: {
    name: '  NorthStar Guide <name> 🧭  ',
    style: '  Warm, concise, and professional.\nDo not invent availability.  ',
    greeting: '  Thank you for calling <Mounted Company>. How may we help? 🌌  ',
  },
});

const LEGACY = Object.freeze({
  assistantName: 'LEGACY ASSISTANT MUST NOT WIN',
  voiceStyle: 'LEGACY STYLE MUST NOT WIN',
  greetingTemplate: 'LEGACY GREETING MUST NOT WIN',
  providerPrivateField: 'PRESERVE RAW LEGACY BYTES',
});

function baseProfile(name) {
  const profile = canonicalFenceProfile({ companyName: name });
  profile.retell = { ...LEGACY };
  return profile;
}

function neutralProfile(source) {
  return {
    ...source,
    industry: RAW.industry,
    ownerName: RAW.ownerName,
    businessDescription: RAW.businessDescription,
    emergencyPolicy: RAW.emergencyPolicy,
    faq: [...RAW.faq],
    companyValues: [...RAW.companyValues],
    customPrompt: RAW.customPrompt,
    voiceAssistant: { ...RAW.voiceAssistant },
  };
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Part 2G mounted provider-neutral Business Profile authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let db;
  let pool;
  let app;
  let auth;
  let otherAuthority;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2g-provider-neutral');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1,'Provider Neutral Organization A','provider-neutral-a@example.test'),
        ($2,'Provider Neutral Organization B','provider-neutral-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, userId + '@m20-part2g.test', role]
      );
    }

    const { putBusinessProfile, bindIntegrationOwner } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, profile: baseProfile('Mounted Neutral Company'),
    });
    otherAuthority = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, profile: baseProfile('Other Tenant Company'),
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      provider: 'retell',
      externalIntegrationId: 'agent-provider-neutral-a',
      metadata: { source: 'intercepted-test', fromNumber: '+15555554800' },
    });

    auth = new Map();
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      auth.set(userId, (await provisionDurableSession(pool, { userId, organizationId, role })).headers);
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

  test('mounted owner write preserves exact bytes while invalid, viewer, and other-tenant mutations fail closed', async () => {
    const loaded = await request(app).get('/api/v1/business-profile').set(auth.get(OWNER_A));
    expect(loaded.status).toBe(200);
    const saved = await request(app)
      .put('/api/v1/business-profile')
      .set(auth.get(OWNER_A))
      .send(neutralProfile(loaded.body.data));
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject(RAW);
    expect(saved.body.data.retell).toEqual(LEGACY);
    const authorityId = saved.body.data.canonicalAuthority.id;

    const bytes = await pool.query(
      `SELECT
         encode(convert_to(raw_profile ->> 'industry', 'UTF8'), 'hex') AS industry_hex,
         encode(convert_to(raw_profile ->> 'ownerName', 'UTF8'), 'hex') AS owner_hex,
         encode(convert_to(raw_profile ->> 'businessDescription', 'UTF8'), 'hex') AS description_hex,
         encode(convert_to(raw_profile ->> 'emergencyPolicy', 'UTF8'), 'hex') AS emergency_hex,
         encode(convert_to(raw_profile #>> '{faq,0}', 'UTF8'), 'hex') AS faq_hex,
         encode(convert_to(raw_profile #>> '{companyValues,1}', 'UTF8'), 'hex') AS value_hex,
         encode(convert_to(raw_profile ->> 'customPrompt', 'UTF8'), 'hex') AS prompt_hex,
         encode(convert_to(raw_profile #>> '{voiceAssistant,name}', 'UTF8'), 'hex') AS assistant_hex,
         encode(convert_to(raw_profile #>> '{voiceAssistant,style}', 'UTF8'), 'hex') AS style_hex,
         encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS greeting_hex,
         raw_profile -> 'retell' AS legacy_retell
       FROM canonical_business_profiles WHERE id = $1`,
      [authorityId]
    );
    expect(bytes.rows).toEqual([{
      industry_hex: hex(RAW.industry),
      owner_hex: hex(RAW.ownerName),
      description_hex: hex(RAW.businessDescription),
      emergency_hex: hex(RAW.emergencyPolicy),
      faq_hex: hex(RAW.faq[0]),
      value_hex: hex(RAW.companyValues[1]),
      prompt_hex: hex(RAW.customPrompt),
      assistant_hex: hex(RAW.voiceAssistant.name),
      style_hex: hex(RAW.voiceAssistant.style),
      greeting_hex: hex(RAW.voiceAssistant.greeting),
      legacy_retell: LEGACY,
    }]);

    const beforeRejected = (await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A]
    )).rows[0].id;
    const viewer = await request(app)
      .put('/api/v1/business-profile')
      .set(auth.get(VIEWER_A))
      .send({ ...saved.body.data, voiceAssistant: { name: 'viewer mutation' } });
    expect(viewer.status).toBe(403);
    expect((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A]
    )).rows[0].id).toBe(beforeRejected);

    for (const [mutate, expected] of [
      [(body) => { body.voiceAssistant = []; }, 'voiceAssistant must be an object'],
      [(body) => { body.voiceAssistant.providerId = 'provider-owned'; }, 'voiceAssistant.providerId is not a supported voice assistant field'],
      [(body) => { body.faq = ['valid', { answer: 'nested' }]; }, 'faq[1] must be a string'],
      [(body) => { body.companyValues = ['valid', 42]; }, 'companyValues[1] must be a string'],
    ]) {
      const body = JSON.parse(JSON.stringify(saved.body.data));
      mutate(body);
      const rejected = await request(app).put('/api/v1/business-profile').set(auth.get(OWNER_A)).send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('INVALID_BUSINESS_PROFILE');
      expect(rejected.body.errors.join('\n')).toContain(expected);
      expect((await pool.query(
        'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_A]
      )).rows[0].id).toBe(beforeRejected);
    }

    expect((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id).toBe(otherAuthority.id);
  });

  test('mounted voice creation pins neutral authority before an intercepted provider boundary', async () => {
    const config = require('../../src/config');
    const originalKey = config.retell.apiKey;
    const originalPhone = config.retell.phoneNumber;
    const originalFetch = global.fetch;
    const observed = [];
    try {
      config.retell.apiKey = 'intercepted-provider-neutral-key';
      config.retell.phoneNumber = '+15555554800';
      global.fetch = jest.fn(async (url, options) => {
        const body = JSON.parse(options.body);
        const pinned = await pool.query(
          `SELECT organization_id, business_profile_id, business_profile_version,
                  business_profile_hash, status
             FROM canonical_voice_sessions
            WHERE organization_id = $1 AND to_number = $2 AND external_session_id LIKE 'pending-%'`,
          [ORG_A, body.to_number]
        );
        expect(pinned.rows).toHaveLength(1);
        observed.push({ url, body, pinned: pinned.rows[0] });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ call_id: 'provider-neutral-call-1', call_status: 'registered' }),
        };
      });

      const viewer = await request(app)
        .post('/api/v1/voice/call')
        .set(auth.get(VIEWER_A))
        .send({ phoneNumber: '+15555554801' });
      expect(viewer.status).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();

      const response = await request(app)
        .post('/api/v1/voice/call')
        .set(auth.get(OWNER_A))
        .send({
          phoneNumber: '+15555554802',
          organizationId: ORG_B,
          profile: { voiceAssistant: { name: 'CALLER MUST NOT WIN' } },
          assistantName: 'CALLER MUST NOT WIN',
          greeting: 'CALLER MUST NOT WIN',
        });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(observed).toHaveLength(1);
      const call = observed[0];
      expect(call.url).toContain('api.retellai.com');
      expect(call.body).toEqual(expect.objectContaining({
        agent_id: 'agent-provider-neutral-a',
        from_number: '+15555554800',
        to_number: '+15555554802',
      }));
      expect(call.body.retell_llm_dynamic_variables).toMatchObject({
        assistant_name: RAW.voiceAssistant.name.trim(),
        industry: RAW.industry.trim(),
        owner_name: RAW.ownerName.trim(),
        business_description: RAW.businessDescription.trim(),
        emergency_policy: RAW.emergencyPolicy.trim(),
        faq: JSON.stringify(RAW.faq),
        company_values: JSON.stringify(RAW.companyValues),
        voice_style: RAW.voiceAssistant.style.trim(),
        custom_prompt: RAW.customPrompt.trim(),
        northstar_greeting: RAW.voiceAssistant.greeting.trim(),
      });
      expect(JSON.stringify(call.body)).not.toMatch(/LEGACY|CALLER MUST NOT WIN|providerPrivateField/);
      expect(call.pinned).toMatchObject({
        organization_id: ORG_A,
        business_profile_id: response.body.profile.id,
        business_profile_version: response.body.profile.version,
        business_profile_hash: response.body.profile.hash,
        status: 'active',
      });
      const durable = await pool.query(
        `SELECT organization_id, business_profile_id, business_profile_version,
                business_profile_hash, external_session_id, status
           FROM canonical_voice_sessions WHERE external_session_id = 'provider-neutral-call-1'`
      );
      expect(durable.rows).toEqual([{
        organization_id: ORG_A,
        business_profile_id: response.body.profile.id,
        business_profile_version: response.body.profile.version,
        business_profile_hash: response.body.profile.hash,
        external_session_id: 'provider-neutral-call-1',
        status: 'active',
      }]);
    } finally {
      global.fetch = originalFetch;
      config.retell.apiKey = originalKey;
      config.retell.phoneNumber = originalPhone;
    }
  });
});
