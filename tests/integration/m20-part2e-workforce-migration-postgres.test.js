'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

realPostgres('Mission 20 Part 2E workforce migration', () => {
  let suiteDatabase;
  let pool;
  let preWorkforceDirectory;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2e-migration');
    pool = new Pool({ connectionString: suiteDatabase.connectionString });
    preWorkforceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-p2e-pre-'));
    const deferred = new Set([
      '015_workforce_authority.sql',
      '020_canonical_workforce_access_roles.sql',
      '032_canonical_schedule_assignment_authority.sql',
      '033_canonical_schedule_time_evidence.sql',
    ]);
    for (const filename of fs.readdirSync(MIGRATIONS).filter(name => /^\d+.*\.sql$/.test(name) && !deferred.has(name))) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preWorkforceDirectory, filename));
    }
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (preWorkforceDirectory && path.resolve(preWorkforceDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preWorkforceDirectory, { recursive: true, force: true });
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('upgrades legacy memberships, creates future profiles atomically, and reruns checksum-exact', async () => {
    jest.resetModules();
    const db = require('../../src/db');
    expect(await db.runMigrations({ pool, migrationsDirectory: preWorkforceDirectory })).toBe(true);

    const organization = '61000000-0000-4000-8000-000000000001';
    const users = [
      ['62000000-0000-4000-8000-000000000001', 'owner', 'Legacy Owner'],
      ['62000000-0000-4000-8000-000000000002', 'admin', 'Legacy Admin'],
      ['62000000-0000-4000-8000-000000000003', 'dispatcher', 'Legacy Dispatcher'],
      ['62000000-0000-4000-8000-000000000004', 'tech', 'Legacy Technician'],
      ['62000000-0000-4000-8000-000000000005', 'member', 'Legacy Member'],
      ['62000000-0000-4000-8000-000000000006', 'viewer', 'Legacy Viewer'],
    ];
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1,'Migration Organization','migration-workforce@example.test')`,
      [organization]
    );
    for (const [userId, role, name] of users) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organization, name, role + '-migration@example.test', role]
      );
      await pool.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
         VALUES ($1,$2,$3,$4,'active')`,
        [userId, organization, userId, role]
      );
    }
    expect((await pool.query("SELECT to_regclass('public.workforce_profiles') AS authority")).rows[0].authority).toBeNull();

    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);
    const identity = await pool.query(
      `SELECT current_setting('server_version_num')::int AS version_num,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('listen_addresses') AS listen_addresses,
              inet_server_port() AS port`
    );
    expect(Math.floor(identity.rows[0].version_num / 10000)).toBe(18);
    expect(identity.rows[0]).toMatchObject({
      timezone: 'UTC', checksums: 'on', listen_addresses: '127.0.0.1',
      port: Number(process.env.M19_EXPECTED_PG_PORT),
    });

    const profiles = await pool.query(
      `SELECT profile.id, profile.membership_id, profile.operational_role,
              profile.created_by_user_id, profile.updated_by_user_id
         FROM workforce_profiles profile
        WHERE profile.organization_id = $1 ORDER BY profile.membership_id`,
      [organization]
    );
    expect(profiles.rows).toEqual([
      ['62000000-0000-4000-8000-000000000001', 'owner'],
      ['62000000-0000-4000-8000-000000000002', 'administrator'],
      ['62000000-0000-4000-8000-000000000003', 'dispatcher'],
      ['62000000-0000-4000-8000-000000000004', 'technician'],
      ['62000000-0000-4000-8000-000000000005', 'employee'],
      ['62000000-0000-4000-8000-000000000006', 'other'],
    ].map(([id, operationalRole]) => ({
      id,
      membership_id: id,
      operational_role: operationalRole,
      created_by_user_id: null,
      updated_by_user_id: null,
    })));

    const accessAuthority = await pool.query(
      `SELECT account.id, account.role AS user_role, membership.role AS access_role
         FROM users account
         JOIN organization_memberships membership ON membership.user_id = account.id
        WHERE account.organization_id = $1
        ORDER BY account.id`,
      [organization]
    );
    expect(accessAuthority.rows).toEqual([
      ['62000000-0000-4000-8000-000000000001', 'owner'],
      ['62000000-0000-4000-8000-000000000002', 'admin'],
      ['62000000-0000-4000-8000-000000000003', 'member'],
      ['62000000-0000-4000-8000-000000000004', 'member'],
      ['62000000-0000-4000-8000-000000000005', 'member'],
      ['62000000-0000-4000-8000-000000000006', 'viewer'],
    ].map(([id, role]) => ({ id, user_role: role, access_role: role })));

    await expect(pool.query(
      `UPDATE organization_memberships SET role = 'dispatcher' WHERE user_id = $1`,
      [users[4][0]]
    )).rejects.toMatchObject({ code: '23514', constraint: 'organization_memberships_role_check' });
    await expect(pool.query(
      `UPDATE users SET role = 'tech' WHERE id = $1`,
      [users[4][0]]
    )).rejects.toMatchObject({ code: '23514', constraint: 'account_users_role_check' });

    const pendingInvitation = '63000000-0000-4000-8000-000000000008';
    await pool.query(
      `INSERT INTO workforce_invitations
        (id, organization_id, name, email, email_normalized, access_role, operational_role,
         token_hash, token_expires_at, created_by_user_id, updated_by_user_id)
       VALUES ($1,$2,'Pending Invite','pending-invite@example.test','pending-invite@example.test',
         'viewer','employee',$3,NOW() + INTERVAL '72 hours',$4,$4)`,
      [pendingInvitation, organization, 'a'.repeat(64), users[0][0]]
    );
    expect((await pool.query(
      `SELECT invitation.status, invitation.accepted_membership_id,
              (SELECT count(*)::int FROM users WHERE organization_id = $1) AS users,
              (SELECT count(*)::int FROM organization_memberships WHERE organization_id = $1) AS memberships,
              (SELECT count(*)::int FROM workforce_profiles WHERE organization_id = $1) AS profiles
         FROM workforce_invitations invitation
        WHERE invitation.organization_id = $1 AND invitation.id = $2`,
      [organization, pendingInvitation]
    )).rows).toEqual([{
      status: 'pending', accepted_membership_id: null, users: 6, memberships: 6, profiles: 6,
    }]);

    const futureUser = '62000000-0000-4000-8000-000000000007';
    const futureMembership = '63000000-0000-4000-8000-000000000007';
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1,$2,'Future Member','future-member@example.test','not-used','viewer','active')`,
      [futureUser, organization]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'viewer','active')`,
      [futureMembership, organization, futureUser]
    );
    expect((await pool.query(
      `SELECT id, membership_id, operational_role FROM workforce_profiles
        WHERE organization_id = $1 AND membership_id = $2`,
      [organization, futureMembership]
    )).rows).toEqual([{
      id: futureMembership,
      membership_id: futureMembership,
      operational_role: 'other',
    }]);

    const catalog = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM organization_memberships WHERE organization_id = $1) AS memberships,
         (SELECT count(*)::int FROM workforce_profiles WHERE organization_id = $1) AS profiles,
         (SELECT count(*)::int FROM workforce_invitations
           WHERE organization_id = $1 AND status = 'pending') AS pending_invitations,
         (SELECT count(*)::int FROM pg_trigger
           WHERE tgname = 'workforce_membership_profile' AND NOT tgisinternal) AS profile_triggers,
         (SELECT count(*)::int FROM pg_constraint
           WHERE connamespace = 'public'::regnamespace
             AND conname LIKE 'workforce_%' AND NOT convalidated) AS unvalidated_constraints,
         (SELECT count(*)::int FROM pg_index index_record
           JOIN pg_class table_record ON table_record.oid = index_record.indrelid
          WHERE table_record.relname LIKE 'workforce_%'
            AND (NOT index_record.indisvalid OR NOT index_record.indisready)) AS invalid_indexes`,
      [organization]
    );
    expect(catalog.rows[0]).toEqual({
      memberships: 7,
      profiles: 7,
      pending_invitations: 1,
      profile_triggers: 1,
      unvalidated_constraints: 0,
      invalid_indexes: 0,
    });

    await expect(pool.query(
      `INSERT INTO workforce_profiles (id, organization_id, membership_id, operational_role)
       VALUES ('64000000-0000-4000-8000-000000000001',$1,$2,'employee')`,
      [organization, futureMembership]
    )).rejects.toMatchObject({ code: '23514', constraint: 'workforce_profiles_stable_membership_identity' });

    const beforeRerun = await pool.query(
      `SELECT count(*)::int AS profile_count,
              (SELECT count(*)::int FROM workforce_audit_events) AS audit_count
         FROM workforce_profiles`
    );
    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect((await pool.query(
      `SELECT count(*)::int AS profile_count,
              (SELECT count(*)::int FROM workforce_audit_events) AS audit_count
         FROM workforce_profiles`
    )).rows).toEqual(beforeRerun.rows);
    for (const filename of [
      '015_workforce_authority.sql',
      '020_canonical_workforce_access_roles.sql',
      '032_canonical_schedule_assignment_authority.sql',
      '033_canonical_schedule_time_evidence.sql',
    ]) {
      const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === filename);
      expect(migration).toBeDefined();
      expect((await pool.query(
        `SELECT trim(checksum) AS checksum, count(*) OVER ()::int AS ledger_count
           FROM _migrations WHERE filename = $1`,
        [filename]
      )).rows).toEqual([{ checksum: migration.digest, ledger_count: 1 }]);
    }
  }, 60000);
});
