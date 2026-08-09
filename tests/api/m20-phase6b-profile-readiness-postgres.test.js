'use strict';

const crypto = require('crypto');
const https = require('https');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = 'b6000000-0000-4000-8000-000000000001';
const ORG_B = 'b6000000-0000-4000-8000-000000000002';
const ORG_DRAFT = 'b6000000-0000-4000-8000-000000000003';
const OWNER_A = 'b6100000-0000-4000-8000-000000000001';
const ADMIN_A = 'b6100000-0000-4000-8000-000000000002';
const MEMBER_A = 'b6100000-0000-4000-8000-000000000003';
const VIEWER_A = 'b6100000-0000-4000-8000-000000000004';
const OWNER_B = 'b6100000-0000-4000-8000-000000000005';
const DRAFT_OWNER = 'b6100000-0000-4000-8000-000000000006';
const HOSTILE = '  保留🧭 e\u0301\r\n<img src=x onerror="globalThis.__phase6b=1">  ';
const ALL_ITEM_IDS = Object.freeze([
  'company_identity',
  'business_locale',
  'active_services',
  'business_contact',
  'business_context',
  'operating_origin',
  'service_area',
  'weekly_hours',
  'customer_guidance',
  'financial_configuration',
  'voice_configuration',
]);

function configuredProfile(companyName) {
  const profile = canonicalFenceProfile({ companyName });
  profile.updatedAt = 'caller-owned-orientation-only';
  profile.company = {
    ...profile.company,
    email: 'office@example.test',
    phone: '',
    timeZone: 'America/New_York',
    currency: 'USD',
  };
  profile.industry = 'Tree care';
  profile.businessDescription = 'Residential and commercial tree work.';
  profile.headquarters = {
    street: '10 Main Street', city: 'Asheville', state: 'NC', zip: '28801', country: 'US',
    latitude: 35.5951, longitude: -82.5515,
    additionalOffices: [{
      id: 'west-office', name: 'West office', street: '20 West Street', city: 'Canton',
      state: 'NC', zip: '28716', country: 'US',
    }],
  };
  profile.routing = { dispatchFrom: 'headquarters', trafficEnabled: false };
  profile.serviceArea = { maxRadiusMiles: 50, maxTravelMinutes: null, primaryTerritory: '', polygon: [] };
  profile.hours = { monday: { open: '08:00', close: '17:00' }, holidays: [] };
  profile.emergencyPolicy = HOSTILE;
  profile.customPrompt = 'Caller guidance\r\n<script>never()</script>';
  profile.faq = ['Do you handle permits?\r\nYes.'];
  profile.companyValues = ['Safety'];
  profile.policies = { cleanup: 'Leave the site clean.' };
  profile.voiceAssistant = {
    name: 'NorthStar Guide', greeting: 'Hello <svg onload=never()>', personality: 'professional',
  };
  profile.integrations = { retell: { enabled: true, status: 'connected', opaque: HOSTILE } };
  return profile;
}

function change(itemId, action) {
  return { itemId, action: action || 'review' };
}

realPostgres('Mission 20 Phase 6B mounted Profile Readiness authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let originalFetch;
  let httpsSpy;
  let db;
  let pool;
  let app;
  let sessions;
  let putBusinessProfile;
  let adaptBusinessProfile;
  const providerAttempts = [];

  async function activeRow(organizationId = ORG_A) {
    return (await pool.query(
      `SELECT id, version_label, raw_profile, normalized_profile_hash,
              encode(convert_to(raw_profile::text, 'UTF8'), 'hex') AS raw_hex,
              raw_profile ? 'profileReadiness' AS has_readiness,
              CASE WHEN raw_profile ? 'profileReadiness'
                   THEN encode(convert_to((raw_profile -> 'profileReadiness')::text, 'UTF8'), 'hex')
                   ELSE NULL END AS readiness_hex,
              encode(convert_to(raw_profile ->> 'emergencyPolicy', 'UTF8'), 'hex') AS emergency_hex,
              (SELECT count(*)::int FROM canonical_business_profiles WHERE organization_id = $1) AS version_count
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [organizationId]
    )).rows[0] || null;
  }

  async function versionCount(organizationId = ORG_A) {
    return Number((await pool.query(
      'SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id = $1',
      [organizationId]
    )).rows[0].count);
  }

  async function readiness(role) {
    return request(app).get('/api/v1/business-profile/profileReadiness').set(sessions[role].headers);
  }

  async function save(role, expectedVersion, changes) {
    return request(app).put('/api/v1/business-profile/profileReadiness')
      .set(sessions[role].headers).send({ expectedVersion, changes });
  }

  async function resetOrganizationA() {
    await pool.query('DELETE FROM organization_onboarding WHERE organization_id = $1', [ORG_A]);
    await pool.query('DELETE FROM canonical_business_profiles WHERE organization_id = $1', [ORG_A]);
    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      profile: configuredProfile('Phase 6B Organization A'),
    });
  }

  beforeAll(async () => {
    originalFetch = global.fetch;
    global.fetch = function () {
      providerAttempts.push('fetch');
      throw new Error('Provider fetch boundary reached during mounted Phase 6B API run.');
    };
    httpsSpy = jest.spyOn(https, 'request').mockImplementation(function () {
      providerAttempts.push('https.request');
      throw new Error('Provider HTTPS boundary reached during mounted Phase 6B API run.');
    });
    suiteDatabase = await createSuiteDatabase('m20-phase6b-readiness');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    expect((await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0]).toEqual({ version: '18.4', timezone: 'UTC', checksums: 'on' });

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 6B Organization A','phase6b-a@example.test'),
       ($2,'Phase 6B Organization B','phase6b-b@example.test'),
       ($3,'Phase 6B Draft Organization','phase6b-draft@example.test')`,
      [ORG_A, ORG_B, ORG_DRAFT]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'], [DRAFT_OWNER, ORG_DRAFT, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase6b.test`, role]
      );
    }
    ({ putBusinessProfile } = require('../../src/services/organizationAuthority'));
    ({ adaptBusinessProfile } = require('../../src/services/businessProfileAdapter'));
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, profile: configuredProfile('Phase 6B Organization A'),
    });
    const other = configuredProfile('Other Tenant');
    other.company.email = '';
    other.company.phone = '';
    await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: other });
    sessions = {};
    for (const [name, userId, organizationId, role] of [
      ['owner', OWNER_A, ORG_A, 'owner'], ['admin', ADMIN_A, ORG_A, 'admin'],
      ['member', MEMBER_A, ORG_A, 'member'], ['viewer', VIEWER_A, ORG_A, 'viewer'],
      ['otherOwner', OWNER_B, ORG_B, 'owner'], ['draftOwner', DRAFT_OWNER, ORG_DRAFT, 'owner'],
    ]) {
      sessions[name] = await provisionDurableSession(pool, { userId, organizationId, role });
    }
    ({ app } = require('../../src/server'));
  }, 60000);

  beforeEach(async () => {
    providerAttempts.length = 0;
    await resetOrganizationA();
    await pool.query('DELETE FROM organization_onboarding WHERE organization_id = $1', [ORG_DRAFT]);
    await pool.query('DELETE FROM canonical_business_profiles WHERE organization_id = $1', [ORG_DRAFT]);
    sessions.draftOwner = await provisionDurableSession(pool, {
      userId: DRAFT_OWNER,
      organizationId: ORG_DRAFT,
      role: 'owner',
    });
  });

  afterEach(() => {
    expect(providerAttempts).toEqual([]);
  });

  afterAll(async () => {
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (httpsSpy) httpsSpy.mockRestore();
      if (originalFetch === undefined) delete global.fetch;
      else global.fetch = originalFetch;
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalAccessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
      else process.env.AUTH_ACCESS_SECRET = originalAccessSecret;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('GET is tenant-scoped for every actual role while only owner and admin can mutate', async () => {
    const projections = [];
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const loaded = await readiness(role);
      expect(loaded.status).toBe(200);
      expect(loaded.body.data).toEqual(expect.objectContaining({
        schemaVersion: 'm20-profile-readiness-v1',
        canonicalAuthority: { version: 'org-profile-v1' },
        overallState: 'review_needed',
        hasStoredReadiness: false,
        itemOrder: ALL_ITEM_IDS,
      }));
      expect(Object.keys(loaded.body.data.items)).toEqual(ALL_ITEM_IDS);
      expect(JSON.stringify(loaded.body.data)).not.toMatch(/reviewedValueHash|<img|<svg|connected|opaque/);
      projections.push(loaded.body.data);
    }
    expect(projections.every(function (projection) { return JSON.stringify(projection) === JSON.stringify(projections[0]); })).toBe(true);

    const other = await readiness('otherOwner');
    expect(other.status).toBe(200);
    expect(other.body.data.items.business_contact.state).toBe('recommended');
    expect(other.body.data.items.business_contact.sourceState).toBe('missing');
    expect(other.body.data.items.company_identity.sourceState).toBe('configured');

    const draft = await readiness('draftOwner');
    expect(draft.status).toBe(200);
    expect(draft.body.onboardingDraft).toBe(true);
    expect(draft.body.data.canonicalAuthority).toEqual({ version: null });
    expect(draft.body.data.hasStoredReadiness).toBe(false);

    for (const role of ['member', 'viewer']) {
      const denied = await save(role, 'org-profile-v1', [change('company_identity')]);
      expect(denied.status).toBe(403);
      expect(await versionCount()).toBe(1);
      expect((await activeRow()).has_readiness).toBe(false);
    }
    const adminSaved = await save('admin', 'org-profile-v1', [change('company_identity')]);
    expect(adminSaved.status).toBe(200);
    expect(adminSaved.body.data.canonicalAuthority.version).toBe('org-profile-v2');
    expect(adminSaved.body.data.items.company_identity.state).toBe('reviewed');
    expect(adminSaved.body.data.items.company_identity.lastReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(adminSaved.body.data)).not.toContain('reviewedValueHash');
    const whole = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    expect(whole.status).toBe(200);
    expect(whole.body.data.profileReadiness).toBeUndefined();
  });

  test('strict envelope rejection and forbidden applicability actions make zero durable writes', async () => {
    const valid = { expectedVersion: 'org-profile-v1', changes: [change('company_identity')] };
    const invalidBodies = [
      { ...valid, lastReviewedAt: '2026-08-09T16:00:00.000Z' },
      { expectedVersion: 1, changes: valid.changes },
      { expectedVersion: 'org-profile-v1', changes: [] },
      { expectedVersion: 'org-profile-v1', changes: [{ itemId: 'unknown_item', action: 'review' }] },
      { expectedVersion: 'org-profile-v1', changes: [change('company_identity'), change('company_identity')] },
      { expectedVersion: 'org-profile-v1', changes: [{
        itemId: 'company_identity', action: 'review', lastReviewedAt: '2026-08-09T16:00:00.000Z',
      }] },
      { expectedVersion: 'org-profile-v1', changes: [{
        itemId: 'company_identity', action: 'review', reviewedValueHash: 'a'.repeat(64),
      }] },
      { expectedVersion: 'org-profile-v1', changes: [{ itemId: 'company_identity', action: 'complete' }] },
      { expectedVersion: 'org-profile-v1', changes: [change('company_identity', 'mark_not_applicable')] },
      { expectedVersion: 'org-profile-v1', changes: [change('company_identity', 'mark_applicable')] },
    ];
    for (const body of invalidBodies) {
      const rejected = await request(app).put('/api/v1/business-profile/profileReadiness')
        .set(sessions.owner.headers).send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.success).toBe(false);
      expect(await versionCount()).toBe(1);
      expect((await activeRow()).has_readiness).toBe(false);
    }
  });

  test('valid mark_applicable clears historical provenance until the restored source is explicitly reviewed again', async () => {
    const reviewed = await save('owner', 'org-profile-v1', [change('service_area')]);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'reviewed', applicability: 'applicable', canReview: false,
      lastReviewedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }));
    let row = await activeRow();
    const historical = JSON.parse(JSON.stringify(row.raw_profile.profileReadiness.items.service_area));
    const reviewedReadinessHex = row.readiness_hex;
    expect(historical).toEqual({
      applicability: 'applicable',
      lastReviewedAt: reviewed.body.data.items.service_area.lastReviewedAt,
      reviewedValueHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const removed = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({
        maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [],
      });
    expect(removed.status).toBe(200);
    row = await activeRow();
    expect(row.version_label).toBe('org-profile-v3');
    expect(row.readiness_hex).toBe(reviewedReadinessHex);
    expect((await readiness('owner')).body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'missing', canMarkNotApplicable: true, canReview: false,
      lastReviewedAt: historical.lastReviewedAt,
    }));

    const marked = await save('owner', row.version_label, [change('service_area', 'mark_not_applicable')]);
    expect(marked.status).toBe(200);
    expect(marked.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'not_applicable', canMarkApplicable: true, lastReviewedAt: historical.lastReviewedAt,
    }));
    row = await activeRow();
    expect(row.raw_profile.profileReadiness.items.service_area).toEqual({
      applicability: 'not_applicable',
      lastReviewedAt: historical.lastReviewedAt,
      reviewedValueHash: historical.reviewedValueHash,
    });
    const markedVersion = row.version_label;
    const markedReadinessHex = row.readiness_hex;

    const unrelatedAdvance = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...row.raw_profile.company, dba: 'Historical provenance stale control' });
    expect(unrelatedAdvance.status).toBe(200);
    const beforeStale = await activeRow();
    expect(beforeStale.readiness_hex).toBe(markedReadinessHex);
    const stale = await save('owner', markedVersion, [change('service_area', 'mark_applicable')]);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await activeRow()).toEqual(beforeStale);

    const cleared = await save(
      'owner', beforeStale.version_label, [change('service_area', 'mark_applicable')]
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'missing', applicability: 'applicable', canReview: false, lastReviewedAt: null,
    }));
    row = await activeRow();
    expect(row.raw_profile.profileReadiness.items.service_area).toEqual({
      applicability: 'applicable', lastReviewedAt: null, reviewedValueHash: null,
    });
    const clearedReadinessHex = row.readiness_hex;
    expect(row.raw_profile.company.dba).toBe('Historical provenance stale control');

    const restored = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({
        maxRadiusMiles: 50, maxTravelMinutes: null, primaryTerritory: '', polygon: [],
      });
    expect(restored.status).toBe(200);
    row = await activeRow();
    expect(row.readiness_hex).toBe(clearedReadinessHex);
    const needsReview = await readiness('owner');
    expect(needsReview.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'needs_review', applicability: 'applicable', canReview: true, lastReviewedAt: null,
    }));

    await new Promise(resolve => setTimeout(resolve, 20));
    const reviewedAgain = await save('owner', row.version_label, [change('service_area')]);
    expect(reviewedAgain.status).toBe(200);
    expect(reviewedAgain.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'reviewed', canReview: false,
      lastReviewedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }));
    expect(Date.parse(reviewedAgain.body.data.items.service_area.lastReviewedAt))
      .toBeGreaterThan(Date.parse(historical.lastReviewedAt));
    row = await activeRow();
    expect(row.raw_profile.profileReadiness.items.service_area).toEqual({
      applicability: 'applicable',
      lastReviewedAt: reviewedAgain.body.data.items.service_area.lastReviewedAt,
      reviewedValueHash: historical.reviewedValueHash,
    });
    expect(row.version_count).toBe(8);

    const beforeRejected = await activeRow();
    const rejected = await save('owner', row.version_label, [change('service_area', 'mark_applicable')]);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('PROFILE_READINESS_MARK_APPLICABLE_UNAVAILABLE');
    expect(await activeRow()).toEqual(beforeRejected);
  });

  test('mark_applicable is state-guarded, stale-safe, and clears Not applicable without review provenance', async () => {
    let cleared = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({
        maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [],
      });
    expect(cleared.status).toBe(200);
    let row = await activeRow();
    const marked = await save('owner', row.version_label, [change('service_area', 'mark_not_applicable')]);
    expect(marked.status).toBe(200);
    expect(marked.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'not_applicable', canMarkApplicable: true, canReview: false, lastReviewedAt: null,
    }));
    row = await activeRow();
    expect(row.raw_profile.profileReadiness.items.service_area).toEqual({
      applicability: 'not_applicable', lastReviewedAt: null, reviewedValueHash: null,
    });
    const markedReadinessHex = row.readiness_hex;

    const configured = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({
        maxRadiusMiles: 25, maxTravelMinutes: null, primaryTerritory: '', polygon: [],
      });
    expect(configured.status).toBe(200);
    row = await activeRow();
    expect(row.readiness_hex).toBe(markedReadinessHex);
    const auditorReproduction = await readiness('owner');
    expect(auditorReproduction.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'needs_review', applicability: 'applicable', canMarkApplicable: false,
      canReview: true, lastReviewedAt: null,
    }));
    const beforeRejectedAction = await activeRow();
    const rejected = await save('owner', row.version_label, [change('service_area', 'mark_applicable')]);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('PROFILE_READINESS_MARK_APPLICABLE_UNAVAILABLE');
    expect(await activeRow()).toEqual(beforeRejectedAction);

    cleared = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({
        maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [],
      });
    expect(cleared.status).toBe(200);
    row = await activeRow();
    expect(row.readiness_hex).toBe(markedReadinessHex);
    expect((await readiness('owner')).body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'not_applicable', canMarkApplicable: true, lastReviewedAt: null,
    }));
    const applicableVersion = row.version_label;

    const unrelatedAdvance = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...row.raw_profile.company, dba: 'Stale action control' });
    expect(unrelatedAdvance.status).toBe(200);
    const beforeStaleAction = await activeRow();
    expect(beforeStaleAction.readiness_hex).toBe(markedReadinessHex);
    const stale = await save('owner', applicableVersion, [change('service_area', 'mark_applicable')]);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await activeRow()).toEqual(beforeStaleAction);

    const restored = await save(
      'owner', beforeStaleAction.version_label, [change('service_area', 'mark_applicable')]
    );
    expect(restored.status).toBe(200);
    expect(restored.body.data.items.service_area).toEqual(expect.objectContaining({
      state: 'missing', applicability: 'applicable', canMarkApplicable: false,
      canMarkNotApplicable: true, canReview: false, lastReviewedAt: null,
    }));
    const afterRestored = await activeRow();
    expect(afterRestored.version_count).toBe(beforeStaleAction.version_count + 1);
    expect(afterRestored.raw_profile.profileReadiness.items.service_area).toEqual({
      applicability: 'applicable', lastReviewedAt: null, reviewedValueHash: null,
    });
    expect(afterRestored.raw_profile.company.dba).toBe('Stale action control');
  });

  test('null first-write, stale retry, and simultaneous expected-version writes are atomic', async () => {
    const first = await save('draftOwner', null, [change('service_area', 'mark_not_applicable')]);
    expect(first.status).toBe(200);
    expect(first.body.data.canonicalAuthority.version).toBe('org-profile-v1');
    expect(first.body.data.items.service_area.state).toBe('not_applicable');
    expect(await versionCount(ORG_DRAFT)).toBe(1);

    const staleFirst = await save('draftOwner', null, [change('operating_origin', 'mark_not_applicable')]);
    expect(staleFirst.status).toBe(409);
    expect(staleFirst.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect(await versionCount(ORG_DRAFT)).toBe(1);

    const simultaneous = await Promise.all([
      save('owner', 'org-profile-v1', [change('company_identity')]),
      save('admin', 'org-profile-v1', [change('business_locale')]),
    ]);
    expect(simultaneous.map(function (response) { return response.status; }).sort()).toEqual([200, 409]);
    expect(simultaneous.find(function (response) { return response.status === 409; }).body.error.code)
      .toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    const after = await activeRow();
    expect(after.version_label).toBe('org-profile-v2');
    expect(after.version_count).toBe(2);
    expect(Object.keys(after.raw_profile.profileReadiness.items)).toHaveLength(1);
  });

  test('dedicated, generic, operational, voice, financial, and whole writers preserve exact readiness and hostile sibling bytes', async () => {
    const reviewed = await save('owner', 'org-profile-v1', [change('customer_guidance')]);
    expect(reviewed.status).toBe(200);
    let before = await activeRow();
    const readinessHex = before.readiness_hex;
    const emergencyHex = before.emergency_hex;
    expect(readinessHex).toMatch(/^[0-9a-f]+$/);
    expect(Buffer.from(emergencyHex, 'hex').toString('utf8')).toBe(HOSTILE);

    const generic = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...before.raw_profile.company, dba: 'Generic writer' });
    expect(generic.status).toBe(200);
    before = await activeRow();
    expect(before.readiness_hex).toBe(readinessHex);
    expect(before.emergency_hex).toBe(emergencyHex);

    const operational = await request(app).put('/api/v1/business-profile/operationalConfiguration')
      .set(sessions.owner.headers).send({
        expectedVersion: before.version_label,
        value: { routing: { trafficEnabled: true } },
      });
    expect(operational.status).toBe(200);
    before = await activeRow();
    expect(before.readiness_hex).toBe(readinessHex);
    expect(before.emergency_hex).toBe(emergencyHex);

    const voice = await request(app).put('/api/v1/business-profile/voiceAssistant')
      .set(sessions.owner.headers).send({
        expectedVersion: before.version_label,
        value: { name: 'Changed voice', personality: 'friendly' },
      });
    expect(voice.status).toBe(200);
    before = await activeRow();
    expect(before.readiness_hex).toBe(readinessHex);
    expect(before.emergency_hex).toBe(emergencyHex);

    const financial = await request(app).put('/api/v1/business-profile/financialConfiguration')
      .set(sessions.owner.headers).send({
        expectedVersion: before.version_label,
        value: { canonicalPricing: { minimumJobPrice: 25 } },
      });
    expect(financial.status).toBe(200);
    before = await activeRow();
    expect(before.readiness_hex).toBe(readinessHex);
    expect(before.emergency_hex).toBe(emergencyHex);

    const loadedWhole = await request(app).get('/api/v1/business-profile').set(sessions.owner.headers);
    expect(loadedWhole.status).toBe(200);
    expect(loadedWhole.body.data.profileReadiness).toBeUndefined();
    loadedWhole.body.data.company.dba = 'Whole writer';
    const whole = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
      expectedVersion: before.version_label,
      value: loadedWhole.body.data,
    });
    expect(whole.status).toBe(200);
    const after = await activeRow();
    expect(after.readiness_hex).toBe(readinessHex);
    expect(after.emergency_hex).toBe(emergencyHex);
    expect(after.raw_profile.customPrompt).toBe('Caller guidance\r\n<script>never()</script>');
    expect(JSON.stringify(whole.body.data)).not.toMatch(/profileReadiness|reviewedValueHash/);
  });

  test('alternate writer orders and a simultaneous generic race preserve readiness presence and raw value', async () => {
    const genericFirst = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...(await activeRow()).raw_profile.company, dba: 'Generic first' });
    expect(genericFirst.status).toBe(200);
    let current = await activeRow();
    expect(current.has_readiness).toBe(false);
    const staleDedicated = await save('owner', 'org-profile-v1', [change('company_identity')]);
    expect(staleDedicated.status).toBe(409);
    expect((await activeRow()).has_readiness).toBe(false);

    const dedicated = await save('owner', current.version_label, [change('company_identity')]);
    expect(dedicated.status).toBe(200);
    current = await activeRow();
    const dedicatedHex = current.readiness_hex;
    const staleWhole = await request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
      expectedVersion: 'org-profile-v2',
      value: current.raw_profile,
    });
    expect(staleWhole.status).toBe(409);
    expect((await activeRow()).readiness_hex).toBe(dedicatedHex);

    await resetOrganizationA();
    const baseline = await activeRow();
    const raced = await Promise.all([
      request(app).put('/api/v1/business-profile/company').set(sessions.owner.headers)
        .send({ ...baseline.raw_profile.company, dba: 'Concurrent generic' }),
      save('admin', baseline.version_label, [change('company_identity')]),
    ]);
    expect(raced[0].status).toBe(200);
    expect([200, 409]).toContain(raced[1].status);
    const racedAfter = await activeRow();
    if (raced[1].status === 200) {
      expect(racedAfter.has_readiness).toBe(true);
      expect(racedAfter.raw_profile.profileReadiness.items.company_identity).toBeDefined();
    } else {
      expect(raced[1].body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
      expect(racedAfter.has_readiness).toBe(false);
    }
    expect(racedAfter.raw_profile.company.dba).toBe('Concurrent generic');
  });

  test('recognized source changes alone invalidate review while integration state and elapsed time do not', async () => {
    const allReviewed = await save('owner', 'org-profile-v1', ALL_ITEM_IDS.map(function (itemId) {
      return change(itemId);
    }));
    expect(allReviewed.status).toBe(200);
    expect(allReviewed.body.data.overallState).toBe('ready_for_configured_uses');
    const reviewedAt = allReviewed.body.data.items.company_identity.lastReviewedAt;

    let row = await activeRow();
    const changedName = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...row.raw_profile.company, name: 'Changed recognized name' });
    expect(changedName.status).toBe(200);
    let projected = await readiness('owner');
    expect(projected.body.data.overallState).toBe('review_needed');
    expect(projected.body.data.items.company_identity.state).toBe('needs_review');
    expect(projected.body.data.items.company_identity.lastReviewedAt).toBe(reviewedAt);
    expect(projected.body.data.items.business_locale.state).toBe('reviewed');

    row = await activeRow();
    expect((await save('owner', row.version_label, [change('company_identity')])).status).toBe(200);
    row = await activeRow();
    const integrationOnly = await request(app).put('/api/v1/business-profile/integrations')
      .set(sessions.owner.headers).send({ retell: { enabled: false, status: 'disconnected', opaque: HOSTILE } });
    expect(integrationOnly.status).toBe(200);
    projected = await readiness('owner');
    expect(projected.body.data.overallState).toBe('ready_for_configured_uses');
    expect(Object.values(projected.body.data.items).every(function (item) {
      return item.state === 'reviewed';
    })).toBe(true);
    expect(JSON.stringify(projected.body.data)).not.toMatch(/disconnected|opaque|<img/);
  });

  test('blank contact and context siblings are hash-neutral while qualifying mounted changes invalidate', async () => {
    let row = await activeRow();
    const contextBaseline = JSON.parse(JSON.stringify(row.raw_profile));
    contextBaseline.businessDescription = '';
    const baselineSaved = await request(app).put('/api/v1/business-profile')
      .set(sessions.owner.headers).send({
        expectedVersion: row.version_label,
        value: contextBaseline,
      });
    expect(baselineSaved.status).toBe(200);

    row = await activeRow();
    expect(row.raw_profile.company).toEqual(expect.objectContaining({
      email: 'office@example.test', phone: '',
    }));
    expect(row.raw_profile.industry).toBe('Tree care');
    expect(row.raw_profile.businessDescription).toBe('');
    const reviewed = await save('owner', row.version_label, [
      change('business_contact'), change('business_context'),
    ]);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.items.business_contact.state).toBe('reviewed');
    expect(reviewed.body.data.items.business_context.state).toBe('reviewed');
    const reviewedAt = reviewed.body.data.items.business_contact.lastReviewedAt;
    expect(reviewed.body.data.items.business_context.lastReviewedAt).toBe(reviewedAt);

    row = await activeRow();
    const readinessHex = row.readiness_hex;
    const storedContact = row.raw_profile.profileReadiness.items.business_contact;
    const storedContext = row.raw_profile.profileReadiness.items.business_context;
    const phoneWhitespace = ' \t\r\n ';
    const phoneSaved = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...row.raw_profile.company, phone: phoneWhitespace });
    expect(phoneSaved.status).toBe(200);
    row = await activeRow();
    expect(row.raw_profile.company.phone).toBe(phoneWhitespace);
    expect(row.readiness_hex).toBe(readinessHex);

    const descriptionWhitespace = '\t \r\n';
    const descriptionChanged = JSON.parse(JSON.stringify(row.raw_profile));
    descriptionChanged.businessDescription = descriptionWhitespace;
    const descriptionSaved = await request(app).put('/api/v1/business-profile')
      .set(sessions.owner.headers).send({
        expectedVersion: row.version_label,
        value: descriptionChanged,
      });
    expect(descriptionSaved.status).toBe(200);
    row = await activeRow();
    expect(row.raw_profile.businessDescription).toBe(descriptionWhitespace);
    expect(row.raw_profile.profileReadiness.items.business_contact).toEqual(storedContact);
    expect(row.raw_profile.profileReadiness.items.business_context).toEqual(storedContext);
    expect(row.readiness_hex).toBe(readinessHex);

    let projected = await readiness('owner');
    for (const itemId of ['business_contact', 'business_context']) {
      expect(projected.body.data.items[itemId]).toEqual(expect.objectContaining({
        sourceState: 'configured', state: 'reviewed', lastReviewedAt: reviewedAt,
      }));
    }

    const emailSaved = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({
        ...row.raw_profile.company,
        email: 'dispatch@example.test',
      });
    expect(emailSaved.status).toBe(200);
    row = await activeRow();
    const industryChanged = JSON.parse(JSON.stringify(row.raw_profile));
    industryChanged.industry = 'Landscaping';
    const industrySaved = await request(app).put('/api/v1/business-profile')
      .set(sessions.owner.headers).send({
        expectedVersion: row.version_label,
        value: industryChanged,
      });
    expect(industrySaved.status).toBe(200);
    row = await activeRow();
    expect(row.raw_profile.company.email).toBe('dispatch@example.test');
    expect(row.raw_profile.industry).toBe('Landscaping');
    expect(row.readiness_hex).toBe(readinessHex);

    projected = await readiness('owner');
    for (const itemId of ['business_contact', 'business_context']) {
      expect(projected.body.data.items[itemId]).toEqual(expect.objectContaining({
        sourceState: 'configured', state: 'needs_review', lastReviewedAt: reviewedAt,
      }));
    }
  });

  test('Not applicable cannot hide later configuration and readiness metadata is calculation-neutral', async () => {
    let row = await activeRow();
    const cleared = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({ maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [] });
    expect(cleared.status).toBe(200);
    row = await activeRow();
    const beforeNormalized = adaptBusinessProfile(row.raw_profile, 'fixed-readiness-neutral-version');
    const marked = await save('owner', row.version_label, [change('service_area', 'mark_not_applicable')]);
    expect(marked.status).toBe(200);
    expect(marked.body.data.items.service_area.state).toBe('not_applicable');
    row = await activeRow();
    const afterNormalized = adaptBusinessProfile(row.raw_profile, 'fixed-readiness-neutral-version');
    expect(afterNormalized).toEqual(beforeNormalized);
    expect(afterNormalized.hash).toBe(beforeNormalized.hash);

    const configured = await request(app).put('/api/v1/business-profile/serviceArea')
      .set(sessions.owner.headers).send({ maxRadiusMiles: 25, maxTravelMinutes: null, primaryTerritory: '', polygon: [] });
    expect(configured.status).toBe(200);
    const projected = await readiness('owner');
    expect(projected.body.data.items.service_area.applicability).toBe('applicable');
    expect(projected.body.data.items.service_area.state).toBe('needs_review');
  });

  test('operating-origin Not applicable is rejected for selected but incomplete origins', async () => {
    let row = await activeRow();
    const blank = await request(app).put('/api/v1/business-profile/operationalConfiguration')
      .set(sessions.owner.headers).send({
        expectedVersion: row.version_label,
        value: { routing: { dispatchFrom: '' } },
      });
    expect(blank.status).toBe(200);
    row = await activeRow();
    const marked = await save('owner', row.version_label, [change('operating_origin', 'mark_not_applicable')]);
    expect(marked.status).toBe(200);
    expect(marked.body.data.items.operating_origin.state).toBe('not_applicable');

    const clearedHeadquarters = await request(app).put('/api/v1/business-profile/headquarters')
      .set(sessions.owner.headers).send({
        street: '', city: '', state: '', zip: '', country: 'US',
        latitude: null, longitude: null, additionalOffices: [],
      });
    expect(clearedHeadquarters.status).toBe(200);
    row = await activeRow();
    const selected = await request(app).put('/api/v1/business-profile/operationalConfiguration')
      .set(sessions.owner.headers).send({
        expectedVersion: row.version_label,
        value: { routing: { dispatchFrom: 'nearest-office' } },
      });
    expect(selected.status).toBe(200);
    const projected = await readiness('owner');
    expect(projected.body.data.items.operating_origin).toEqual(expect.objectContaining({
      applicability: 'applicable',
      canMarkNotApplicable: false,
      state: 'missing',
    }));
    row = await activeRow();
    const rejected = await save('owner', row.version_label, [
      change('operating_origin', 'mark_not_applicable'),
    ]);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('PROFILE_READINESS_NOT_APPLICABLE_CONFLICT');
    expect((await activeRow()).version_label).toBe(row.version_label);
  });

  test('other tenant raw authority remains byte-for-byte unchanged across all organization A writes', async () => {
    const before = await activeRow(ORG_B);
    expect((await save('owner', 'org-profile-v1', [change('company_identity')])).status).toBe(200);
    const row = await activeRow();
    expect((await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({ ...row.raw_profile.company, dba: HOSTILE })).status).toBe(200);
    const after = await activeRow(ORG_B);
    expect(after.id).toBe(before.id);
    expect(after.version_label).toBe(before.version_label);
    expect(after.raw_profile).toEqual(before.raw_profile);
    expect(after.normalized_profile_hash).toBe(before.normalized_profile_hash);
    expect(after.version_count).toBe(before.version_count);
  });
});
