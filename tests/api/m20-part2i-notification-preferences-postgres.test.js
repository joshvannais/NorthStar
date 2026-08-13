'use strict';

const crypto = require('crypto');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '91000000-0000-4000-8000-000000000001';
const ORG_B = '91000000-0000-4000-8000-000000000002';
const OWNER_A = '92000000-0000-4000-8000-000000000001';
const ADMIN_A = '92000000-0000-4000-8000-000000000002';
const MEMBER_A = '92000000-0000-4000-8000-000000000003';
const VIEWER_A = '92000000-0000-4000-8000-000000000004';
const OWNER_B = '92000000-0000-4000-8000-000000000005';

const LEGACY_NOTIFICATIONS = Object.freeze({
  email: false,
  sms: true,
  push: true,
  dailyExecutiveBriefing: false,
  revenueAlerts: true,
  crewAlerts: false,
  criticalAlerts: true,
  legacyLabel: '  </span><img src=x onerror=never()>\r\nlegacy notification bytes  ',
});

function profileFor(name, notifications) {
  const profile = canonicalFenceProfile({ companyName: name });
  profile.notifications = JSON.parse(JSON.stringify(notifications));
  return profile;
}

function writable(overrides = {}) {
  return {
    emailEnabled: true,
    emailCallSummary: false,
    emailAppointment: true,
    smsEnabled: false,
    smsUrgent: true,
    emailAddress: 'dispatch@example.test',
    smsNumber: '+1 (860) 555-0101',
    ...overrides,
  };
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

realPostgres('Mission 20 Part 2I mounted canonical notification preferences', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let originalAccessSecret;
  let originalFetch;
  let db;
  let pool;
  let app;
  let sessions;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2i-notifications');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
    originalFetch = global.fetch;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    global.fetch = jest.fn(async () => { throw new Error('provider boundary must remain unused'); });
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
        ($1,'Notification Authority A','notification-a@example.test'),
        ($2,'Notification Authority B','notification-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@m20-part2i.test`, role]
      );
    }
    await pool.query(
      `INSERT INTO notification_preferences (
         organization_id, email_new_lead, email_call_summary, email_appointment,
         sms_new_lead, sms_urgent, notification_email, notification_phone
       ) VALUES
         ($1,TRUE,FALSE,TRUE,FALSE,TRUE,'  persisted@example.test  ','  +1 (860) 555-0199  '),
         ($2,FALSE,TRUE,FALSE,TRUE,FALSE,'other-tenant@example.test','+1 212 555 0100')`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,'{}'::jsonb),($2,'{}'::jsonb)`,
      [ORG_A, ORG_B]
    );

    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: null,
      profile: profileFor('Notification Authority A', LEGACY_NOTIFICATIONS),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, expectedVersion: null,
      profile: profileFor('Notification Authority B', { email: true, otherTenant: 'do-not-touch' }),
    });

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
      global.fetch = originalFetch;
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalAccessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
      else process.env.AUTH_ACCESS_SECRET = originalAccessSecret;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  }, 60000);

  test('all roles read the same tenant-scoped seven-field canonical projection', async () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const response = await request(app)
        .get('/api/account/preferences')
        .query({ organizationId: ORG_B, emailEnabled: false })
        .set(sessions[role].headers);
      expect(response.status).toBe(200);
      expect(response.body.preferences).toMatchObject({
        emailEnabled: true,
        emailCallSummary: false,
        emailAppointment: true,
        smsEnabled: false,
        smsUrgent: true,
        emailAddress: '  persisted@example.test  ',
        smsNumber: '  +1 (860) 555-0199  ',
        securityEmailMandatory: true,
      });
      expect(response.body.preferences.securityEmailAddress).toBe(`${role}-${[OWNER_A, ADMIN_A, MEMBER_A, VIEWER_A][['owner', 'admin', 'member', 'viewer'].indexOf(role)].slice(-4)}@m20-part2i.test`);
      expect(JSON.stringify(response.body)).not.toContain('other-tenant@example.test');
    }
    expect((await request(app).get('/api/account/preferences')).status).toBe(401);
  });

  test('owner and admin update exact canonical rows while member and viewer writes remain zero', async () => {
    const ownerWrite = await request(app)
      .put('/api/account/preferences')
      .set(sessions.owner.headers)
      .send(writable({ emailAddress: '  Owner.Dispatch@Example.Test  ' }));
    expect(ownerWrite.status).toBe(200);
    expect(ownerWrite.body.preferences).toMatchObject({
      ...writable({ emailAddress: 'owner.dispatch@example.test' }),
      securityEmailMandatory: true,
    });

    const adminValue = writable({
      emailEnabled: false,
      emailCallSummary: true,
      emailAppointment: false,
      smsEnabled: true,
      smsUrgent: false,
      emailAddress: 'admin.dispatch@example.test',
      smsNumber: '+1 860 555 0111',
    });
    const adminWrite = await request(app)
      .put('/api/account/preferences')
      .set(sessions.admin.headers)
      .send(adminValue);
    expect(adminWrite.status).toBe(200);
    expect(adminWrite.body.preferences).toMatchObject(adminValue);

    const beforeReadOnly = await canonicalRows();
    for (const role of ['member', 'viewer']) {
      const denied = await request(app)
        .put('/api/account/preferences')
        .set(sessions[role].headers)
        .send(writable());
      expect(denied.status).toBe(403);
    }
    expect(await canonicalRows()).toEqual(beforeReadOnly);
    expect(beforeReadOnly).toEqual([
      expect.objectContaining({
        organization_id: ORG_A,
        email_new_lead: false,
        email_call_summary: true,
        email_appointment: false,
        sms_new_lead: true,
        sms_urgent: false,
        notification_email: 'admin.dispatch@example.test',
        notification_phone: '+1 860 555 0111',
      }),
      expect.objectContaining({
        organization_id: ORG_B,
        notification_email: 'other-tenant@example.test',
        notification_phone: '+1 212 555 0100',
      }),
    ]);
  });

  test('malformed, unknown, read-only, oversized, and foreign-tenant values fail closed', async () => {
    const missing = writable();
    delete missing.smsUrgent;
    const inputs = [
      missing,
      writable({ emailEnabled: 'true' }),
      writable({ emailAddress: 'not-an-email' }),
      writable({ smsNumber: 'call-provider-now' }),
      { ...writable(), securityEmailMandatory: false },
      { ...writable(), securityEmailAddress: 'override@example.test' },
      { ...writable(), organizationId: ORG_B },
      { ...writable(), unexpectedPreference: true },
      { ...writable(), companyInfo: 'x'.repeat(40000) },
    ];
    const before = await canonicalRows();
    for (const body of inputs) {
      const rejected = await request(app)
        .put('/api/account/preferences')
        .set(sessions.owner.headers)
        .send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('invalid_preferences');
    }
    expect(await canonicalRows()).toEqual(before);
  });

  test('unrelated Business Profile saves preserve legacy notification bytes and cannot alter canonical preferences', async () => {
    const canonicalBefore = await canonicalRows();
    const loaded = await request(app)
      .get('/api/v1/business-profile')
      .set(sessions.owner.headers);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.notifications).toEqual(LEGACY_NOTIFICATIONS);
    loaded.body.data.company.dba = 'Unrelated profile edit';
    const saved = await request(app)
      .put('/api/v1/business-profile')
      .set(sessions.owner.headers)
      .send({
        expectedVersion: loaded.body.data.canonicalAuthority.version,
        value: loaded.body.data,
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.notifications).toEqual(LEGACY_NOTIFICATIONS);

    const raw = await pool.query(
      `SELECT raw_profile -> 'notifications' AS notifications,
              encode(convert_to(raw_profile #>> '{notifications,legacyLabel}', 'UTF8'), 'hex') AS legacy_hex
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    );
    expect(raw.rows).toEqual([{
      notifications: LEGACY_NOTIFICATIONS,
      legacy_hex: hex(LEGACY_NOTIFICATIONS.legacyLabel),
    }]);
    expect(await canonicalRows()).toEqual(canonicalBefore);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  async function canonicalRows() {
    const result = await pool.query(
      `SELECT organization_id, email_new_lead, email_call_summary, email_appointment,
              sms_new_lead, sms_urgent, notification_email, notification_phone
         FROM notification_preferences
        WHERE organization_id IN ($1,$2)
        ORDER BY organization_id`,
      [ORG_A, ORG_B]
    );
    return result.rows;
  }
});
