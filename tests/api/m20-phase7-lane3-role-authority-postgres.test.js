'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const ORG_A = '84000000-0000-4000-8000-000000000001';
const ORG_B = '84000000-0000-4000-8000-000000000002';
const OWNER_A = '85000000-0000-4000-8000-000000000001';
const DISPATCHER_A = '85000000-0000-4000-8000-000000000002';
const TECHNICIAN_A = '85000000-0000-4000-8000-000000000003';
const OWNER_B = '85000000-0000-4000-8000-000000000004';

realPostgres('Mission 20 Phase 7 Lane 3 mounted canonical role authority', () => {
  let suiteDatabase;
  let bootstrapPool;
  let preRoleDirectory;
  let db;
  let pool;
  let app;
  let sessions;
  let originalDatabaseUrl;
  let originalFetch;
  const providerVariables = [
    'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
  ];
  const originalProviders = new Map();

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-p7-l3-role');
    originalDatabaseUrl = process.env.DATABASE_URL;
    for (const name of providerVariables) {
      originalProviders.set(name, process.env[name]);
      delete process.env[name];
    }
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    preRoleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-p7-l3-pre-'));
    for (const filename of fs.readdirSync(MIGRATIONS).filter(name =>
      /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name !== '020_canonical_workforce_access_roles.sql')) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preRoleDirectory, filename));
    }

    jest.resetModules();
    db = require('../../src/db');
    bootstrapPool = new Pool({ connectionString: suiteDatabase.connectionString });
    expect(await db.runMigrations({ pool: bootstrapPool, migrationsDirectory: preRoleDirectory })).toBe(true);
    expect((await bootstrapPool.query(
      "SELECT count(*)::int AS applied FROM _migrations WHERE filename = '020_canonical_workforce_access_roles.sql'"
    )).rows[0].applied).toBe(0);

    await bootstrapPool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Lane 3 Tenant A','lane3-a@example.test'),
       ($2,'Lane 3 Tenant B','lane3-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [id, organizationId, name, email, role] of [
      [OWNER_A, ORG_A, 'Lane 3 Owner', 'lane3-owner@example.test', 'owner'],
      [DISPATCHER_A, ORG_A, 'Legacy Dispatcher', 'legacy-dispatcher@example.test', 'dispatcher'],
      [TECHNICIAN_A, ORG_A, 'Legacy Technician', 'legacy-technician@example.test', 'tech'],
      [OWNER_B, ORG_B, 'Other Tenant Owner', 'other-owner@example.test', 'owner'],
    ]) {
      await bootstrapPool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [id, organizationId, name, email, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(bootstrapPool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      profile: canonicalFenceProfile({ companyName: 'Lane 3 Tenant A' }),
    });
    await putBusinessProfile(bootstrapPool, {
      organizationId: ORG_B,
      userId: OWNER_B,
      profile: canonicalFenceProfile({ companyName: 'Lane 3 Tenant B' }),
    });

    sessions = new Map();
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'],
      [DISPATCHER_A, ORG_A, 'dispatcher'],
      [TECHNICIAN_A, ORG_A, 'tech'],
      [OWNER_B, ORG_B, 'owner'],
    ]) {
      sessions.set(userId, await provisionDurableSession(bootstrapPool, { userId, organizationId, role }));
    }
    expect((await bootstrapPool.query(
      `SELECT membership.role, profile.operational_role
         FROM organization_memberships membership
         JOIN workforce_profiles profile ON profile.membership_id = membership.id
        WHERE membership.user_id IN ($1,$2)
        ORDER BY membership.user_id`,
      [DISPATCHER_A, TECHNICIAN_A]
    )).rows).toEqual([
      { role: 'dispatcher', operational_role: 'dispatcher' },
      { role: 'tech', operational_role: 'technician' },
    ]);

    expect(await db.runMigrations({ pool: bootstrapPool, migrationsDirectory: MIGRATIONS })).toBe(true);
    await bootstrapPool.end();
    bootstrapPool = null;
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => { throw new Error('provider boundary must remain unused'); });
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
    try {
      if (bootstrapPool) await bootstrapPool.end();
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      for (const [name, value] of originalProviders) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      if (preRoleDirectory && path.resolve(preRoleDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preRoleDirectory, { recursive: true, force: true });
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('upgrade preserves operational identity and active durable sessions while canonicalizing access', async () => {
    const authority = await pool.query(
      `SELECT account.id, account.role AS user_role, membership.role AS access_role,
              profile.operational_role, session.status AS session_status
         FROM users account
         JOIN organization_memberships membership ON membership.user_id = account.id
         JOIN workforce_profiles profile ON profile.membership_id = membership.id
         JOIN auth_sessions session ON session.membership_id = membership.id
        WHERE account.id IN ($1,$2)
        ORDER BY account.id`,
      [DISPATCHER_A, TECHNICIAN_A]
    );
    expect(authority.rows).toEqual([
      {
        id: DISPATCHER_A, user_role: 'member', access_role: 'member',
        operational_role: 'dispatcher', session_status: 'active',
      },
      {
        id: TECHNICIAN_A, user_role: 'member', access_role: 'member',
        operational_role: 'technician', session_status: 'active',
      },
    ]);
    const constraints = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname IN ('account_users_role_check','organization_memberships_role_check')
        ORDER BY conname`
    );
    expect(constraints.rows).toHaveLength(2);
    for (const constraint of constraints.rows) {
      expect(constraint.definition).toMatch(/owner.*admin.*member.*viewer/);
      expect(constraint.definition).not.toMatch(/dispatcher|tech/);
    }
    expect((await pool.query(
      `SELECT trim(checksum) AS checksum FROM _migrations
        WHERE filename = '020_canonical_workforce_access_roles.sql'`
    )).rows).toHaveLength(1);
    const identity = (await pool.query(
      `SELECT current_setting('server_version_num')::int AS version_num,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('max_connections')::int AS max_connections,
              inet_server_port() AS port`
    )).rows[0];
    expect(Math.floor(identity.version_num / 10000)).toBe(18);
    expect(identity).toMatchObject({
      timezone: 'UTC', checksums: 'on', max_connections: 100,
      port: Number(process.env.M19_EXPECTED_PG_PORT),
    });
  });

  test('pre-migration sessions resolve as members on mounted routes with tenant, RBAC, and CSRF fail-closed', async () => {
    const { navigationForRole } = require('../../src/auth/permissions');
    for (const [userId, operationalRole] of [
      [DISPATCHER_A, 'dispatcher'],
      [TECHNICIAN_A, 'technician'],
    ]) {
      const session = sessions.get(userId);
      const me = await request(app).get('/api/auth/me').set(session.headers);
      expect(me.status).toBe(200);
      expect(me.body.account.membership).toMatchObject({ role: 'member', status: 'active' });
      expect(me.body.account.navigation).toEqual(navigationForRole('member'));

      const workforce = await request(app)
        .get('/api/workforce')
        .query({ organizationId: ORG_B, userId: OWNER_B })
        .set(session.headers);
      expect(workforce.status).toBe(200);
      expect(workforce.body.data.members).toEqual(expect.arrayContaining([
        expect.objectContaining({ userId, accessRole: 'member', operationalRole }),
      ]));
      expect(JSON.stringify(workforce.body)).not.toMatch(/Other Tenant Owner|other-owner@example\.test/);

      const privilege = await request(app).post('/api/workforce/skills').set(session.headers).send({
        key: 'legacy-escalation', name: 'Forbidden', description: '', serviceId: null,
      });
      expect(privilege.status).toBe(403);
      expect(privilege.body).toMatchObject({ error: 'Insufficient permissions' });

      const csrf = await request(app).post('/api/workforce/skills')
        .set('Cookie', session.headers.Cookie).send({
          key: 'csrf-escalation', name: 'Forbidden', description: '', serviceId: null,
        });
      expect(csrf.status).toBe(403);
      expect(csrf.body).toMatchObject({ code: 'csrf_invalid' });
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each(['dispatcher', 'tech', 'technician', 'unknown', 'OWNER'])('malformed session authority role %s is rejected before projection', async role => {
    const credentials = require('../../src/auth/credentials');
    const { requireSession } = require('../../src/auth/middleware');
    const userId = '86000000-0000-4000-8000-000000000001';
    const sessionId = crypto.randomUUID();
    const malformed = express();
    malformed.locals.accountRepository = {
      sessionAuthority: jest.fn(async () => ({
        session_id: sessionId,
        user_id: userId,
        organization_id: ORG_A,
        session_status: 'active',
        access_expires_at: new Date(Date.now() + 60000),
        csrf_token_hash: credentials.hashToken('unused-get-csrf'),
        membership_status: 'active',
        user_status: 'active',
        role,
      })),
    };
    malformed.get('/probe', requireSession, (_req, res) => res.json({ projected: true }));
    const access = credentials.signAccess(userId, sessionId);
    const response = await request(malformed)
      .get('/probe')
      .set('Cookie', `${credentials.ACCESS_COOKIE}=${encodeURIComponent(access)}`);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'organization_membership_required' });
  });
});
