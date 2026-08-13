'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const {
  projectFinancialConfiguration,
  projectOperationalConfiguration,
} = require('../../src/services/businessProfileAdapter');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '86000000-0000-4000-8000-000000000001';
const ORG_B = '86000000-0000-4000-8000-000000000002';
const OWNER_A = '87000000-0000-4000-8000-000000000001';
const ADMIN_A = '87000000-0000-4000-8000-000000000002';
const VIEWER_A = '87000000-0000-4000-8000-000000000003';
const OWNER_B = '87000000-0000-4000-8000-000000000004';

function profileFor(name) {
  return {
    ...canonicalFenceProfile({ companyName: name }),
    company: { name, currency: 'USD', email: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}@example.test` },
    headquarters: { additionalOffices: [] },
    routing: {
      preferredProvider: '', dispatchFrom: '', trafficEnabled: false,
      useLiveTraffic: false, avoidTolls: false, avoidHighways: false, avoidFerries: false,
    },
    scheduling: {
      maxJobsPerDay: null, travelBuffer: null, appointmentBuffer: null,
      workDayLength: null, maxDailyTravel: null, preferredDispatchStrategy: '',
    },
    voiceAssistant: {
      name: 'NorthStar', greeting: 'Thank you for calling.', personality: 'professional',
      escalationRules: { rules: [] },
    },
    workforce: { policies: [] },
  };
}

realPostgres('Mission 20 Phase 7 Lane 4 mounted profile concurrency', () => {
  let suiteDatabase;
  let db;
  let pool;
  let app;
  let putBusinessProfile;
  let getActiveBusinessProfile;
  let sessions;
  let originalDatabaseUrl;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-p7-l4-profile-cas');
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    ({ putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority'));
    app = require('../helpers/account-test-app').createDisposableAccountApp();

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Lane 4 Tenant A','lane4-a@example.test'),
       ($2,'Lane 4 Tenant B','lane4-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [id, organizationId, name, email, role] of [
      [OWNER_A, ORG_A, 'Lane 4 Owner', 'lane4-owner@example.test', 'owner'],
      [ADMIN_A, ORG_A, 'Lane 4 Admin', 'lane4-admin@example.test', 'admin'],
      [VIEWER_A, ORG_A, 'Lane 4 Viewer', 'lane4-viewer@example.test', 'viewer'],
      [OWNER_B, ORG_B, 'Other Tenant Owner', 'lane4-other@example.test', 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [id, organizationId, name, email, role]
      );
    }
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: null,
      profile: profileFor('Lane 4 Tenant A'),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, expectedVersion: null,
      profile: profileFor('Lane 4 Tenant B'),
    });
    sessions = {
      owner: await provisionDurableSession(pool, { userId: OWNER_A, organizationId: ORG_A, role: 'owner' }),
      admin: await provisionDurableSession(pool, { userId: ADMIN_A, organizationId: ORG_A, role: 'admin' }),
      viewer: await provisionDurableSession(pool, { userId: VIEWER_A, organizationId: ORG_A, role: 'viewer' }),
      other: await provisionDurableSession(pool, { userId: OWNER_B, organizationId: ORG_B, role: 'owner' }),
    };
  }, 60000);

  afterAll(async () => {
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  async function profileState(organizationId = ORG_A) {
    const result = await pool.query(
      `SELECT profile.id, profile.version_label, profile.version_number, profile.raw_profile,
              profile.normalized_profile_hash, profile.created_at,
              onboarding.active_business_profile_id, onboarding.updated_at AS onboarding_updated_at,
              (SELECT count(*)::int FROM canonical_business_profiles history
                WHERE history.organization_id = profile.organization_id) AS history_count
         FROM canonical_business_profiles profile
         JOIN organization_onboarding onboarding ON onboarding.organization_id = profile.organization_id
        WHERE profile.organization_id = $1 AND profile.is_active = TRUE`,
      [organizationId]
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0];
  }

  function configuredProjection(value) {
    return Object.fromEntries(Object.entries(value).filter(function (entry) {
      return Object.keys(entry[1]).length > 0;
    }));
  }

  test('whole and section HTTP writers require exact version envelopes', async () => {
    const before = await profileState();
    const rawWhole = await request(app).put('/api/v1/business-profile')
      .set(sessions.owner.headers).send(before.raw_profile);
    expect(rawWhole.status).toBe(400);
    expect(rawWhole.body.error.code).toBe('INVALID_BUSINESS_PROFILE_WRITE');

    const rawSection = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send(before.raw_profile.company);
    expect(rawSection.status).toBe(400);
    expect(rawSection.body.error.code).toBe('INVALID_BUSINESS_PROFILE_SECTION_WRITE');

    const section = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({
        expectedVersion: before.version_label,
        value: { ...before.raw_profile.company, name: 'Lane 4 Envelope Company' },
      });
    expect(section.status).toBe(200);
    expect(section.body.data.company.name).toBe('Lane 4 Envelope Company');
  });

  test('service mutation without an expectation is rejected before it can overwrite an existing profile', async () => {
    const before = await getActiveBusinessProfile(pool, ORG_A);
    await expect(putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      profile: { ...before.rawProfile, company: { ...before.rawProfile.company, name: 'Unversioned overwrite' } },
    })).rejects.toMatchObject({ status: 400, code: 'INVALID_BUSINESS_PROFILE_VERSION' });
    expect((await getActiveBusinessProfile(pool, ORG_A)).id).toBe(before.id);
  });

  test('concurrent exact-version writers produce one commit and one stale 409', async () => {
    const before = await profileState();
    const whole = JSON.parse(JSON.stringify(before.raw_profile));
    whole.company.name = 'Concurrent whole winner';
    const [left, right] = await Promise.all([
      request(app).put('/api/v1/business-profile').set(sessions.owner.headers).send({
        expectedVersion: before.version_label,
        value: whole,
      }),
      request(app).put('/api/v1/business-profile/workforce').set(sessions.admin.headers).send({
        expectedVersion: before.version_label,
        value: { policies: [{ id: 'race-policy', name: 'Race policy', description: '', enabled: true }] },
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const conflict = left.status === 409 ? left : right;
    expect(conflict.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    const after = await profileState();
    expect(Number(after.version_number)).toBe(Number(before.version_number) + 1);
    expect(after.history_count).toBe(before.history_count + 1);
  });

  test('true no-op returns the current authority without version or onboarding side effects', async () => {
    const before = await profileState();
    const saved = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.owner.headers).send({
        expectedVersion: before.version_label,
        value: before.raw_profile.company,
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.canonicalAuthority.version).toBe(before.version_label);
    const after = await profileState();
    expect(after).toMatchObject({
      id: before.id,
      version_label: before.version_label,
      version_number: before.version_number,
      normalized_profile_hash: before.normalized_profile_hash,
      active_business_profile_id: before.active_business_profile_id,
      history_count: before.history_count,
    });
    expect(after.created_at.toISOString()).toBe(before.created_at.toISOString());
    expect(after.onboarding_updated_at.toISOString()).toBe(before.onboarding_updated_at.toISOString());
  });

  test('every mounted profile writer suppresses true no-op versions and side effects', async () => {
    let baseline = await profileState();
    const readinessSeed = await request(app).put('/api/v1/business-profile/profileReadiness')
      .set(sessions.owner.headers).send({
        expectedVersion: baseline.version_label,
        changes: [{ itemId: 'service_area', action: 'mark_not_applicable' }],
      });
    expect(readinessSeed.status).toBe(200);
    baseline = await profileState();

    const writes = [
      ['/api/v1/business-profile', {
        expectedVersion: baseline.version_label,
        value: baseline.raw_profile,
      }],
      ['/api/v1/business-profile/operationalConfiguration', {
        expectedVersion: baseline.version_label,
        value: configuredProjection(projectOperationalConfiguration(baseline.raw_profile)),
      }],
      ['/api/v1/business-profile/financialConfiguration', {
        expectedVersion: baseline.version_label,
        value: configuredProjection(projectFinancialConfiguration(baseline.raw_profile)),
      }],
      ['/api/v1/business-profile/voiceAssistant', {
        expectedVersion: baseline.version_label,
        value: baseline.raw_profile.voiceAssistant,
      }],
      ['/api/v1/business-profile/profileReadiness', {
        expectedVersion: baseline.version_label,
        changes: [{ itemId: 'service_area', action: 'mark_not_applicable' }],
      }],
      ['/api/v1/business-profile/company', {
        expectedVersion: baseline.version_label,
        value: baseline.raw_profile.company,
      }],
    ];
    for (const [url, write] of writes) {
      const saved = await request(app).put(url).set(sessions.owner.headers).send(write);
      expect({ url, status: saved.status, error: saved.body.error }).toEqual({
        url, status: 200, error: undefined,
      });
      const after = await profileState();
      expect(after).toMatchObject({
        id: baseline.id,
        version_label: baseline.version_label,
        version_number: baseline.version_number,
        normalized_profile_hash: baseline.normalized_profile_hash,
        active_business_profile_id: baseline.active_business_profile_id,
        history_count: baseline.history_count,
      });
      expect(after.created_at.toISOString()).toBe(baseline.created_at.toISOString());
      expect(after.onboarding_updated_at.toISOString()).toBe(baseline.onboarding_updated_at.toISOString());
    }
  });

  test('failed insertion rolls back retirement and leaves the active authority intact', async () => {
    const before = await getActiveBusinessProfile(pool, ORG_A);
    await expect(putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: crypto.randomUUID(),
      expectedVersion: before.versionLabel,
      profile: { ...before.rawProfile, company: { ...before.rawProfile.company, name: 'Rollback sentinel' } },
    })).rejects.toMatchObject({ code: '23503' });
    const after = await getActiveBusinessProfile(pool, ORG_A);
    expect(after.id).toBe(before.id);
    expect(after.versionLabel).toBe(before.versionLabel);
    expect(after.rawProfile.company.name).not.toBe('Rollback sentinel');
  });

  test('tenant, role, and CSRF authority fail closed before profile mutation', async () => {
    const beforeA = await profileState(ORG_A);
    const beforeB = await profileState(ORG_B);
    const body = {
      expectedVersion: 'org-profile-v999999',
      value: { ...beforeA.raw_profile.company, name: 'Forbidden mutation' },
    };
    expect((await request(app).put('/api/v1/business-profile/company')
      .set(sessions.viewer.headers).send(body)).status).toBe(403);
    expect((await request(app).put('/api/v1/business-profile/company')
      .set({ Cookie: sessions.owner.headers.Cookie, 'X-CSRF-Token': 'wrong' }).send(body)).status).toBe(403);
    const crossTenant = await request(app).put('/api/v1/business-profile/company')
      .set(sessions.other.headers).send(body);
    expect(crossTenant.status).toBe(409);
    expect(crossTenant.body.error.code).toBe('BUSINESS_PROFILE_VERSION_CONFLICT');
    expect((await profileState(ORG_A)).id).toBe(beforeA.id);
    expect((await profileState(ORG_B)).id).toBe(beforeB.id);
  });

  test('fresh migration ledger is checksum-complete and reruns without mutation', async () => {
    const before = (await pool.query(
      'SELECT filename, trim(checksum) AS checksum, applied_at FROM _migrations ORDER BY filename'
    )).rows;
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(function (row) { return /^[0-9a-f]{64}$/.test(row.checksum); })).toBe(true);
    expect(await db.runMigrations({ pool })).toBe(true);
    const after = (await pool.query(
      'SELECT filename, trim(checksum) AS checksum, applied_at FROM _migrations ORDER BY filename'
    )).rows;
    expect(after).toEqual(before);
  });
});
