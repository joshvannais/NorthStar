'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const MAP_MIGRATION = '018_canonical_map_preferences.sql';

function migrationFiles(directory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

async function rawDigest(pool, table, order) {
  const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
  return crypto.createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

realPostgres('Mission 20 Phase 6D canonical map preference migration', () => {
  let suiteDatabase;
  let pool;
  let preMapDirectory;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-phase6d-map-migration');
    pool = new Pool({ connectionString: suiteDatabase.connectionString });
    preMapDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-phase6d-pre-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name < MAP_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preMapDirectory, filename));
    }
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (preMapDirectory && path.resolve(preMapDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preMapDirectory, { recursive: true, force: true });
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('upgrades authentic history additively, enforces both normalized authorities, and records exact source', async () => {
    jest.resetModules();
    const db = require('../../src/db');
    const corpus = migrationFiles(MIGRATIONS);
    expect(corpus).toEqual([
      '001_initial_schema.sql',
      '002_seed_data.sql',
      '003_voice_sessions.sql',
      '004_canonical_persistence_v2.sql',
      '005_canonical_organization_authority.sql',
      '006_canonical_voice_sessions.sql',
      '007_canonical_tax_authority.sql',
      '008_canonical_demo_authority.sql',
      '009_canonical_voice_provider_identity.sql',
      '010_account_session_authority.sql',
      '011_oauth_authorization_states.sql',
      '012_account_verification_trial.sql',
      '015_workforce_authority.sql',
      '016_tenant_asset_catalogue.sql',
      '017_retell_webhook_replay_authority.sql',
      MAP_MIGRATION,
      '019_account_email_outbox.sql',
      '020_canonical_workforce_access_roles.sql',
    ]);
    for (const filename of corpus) {
      const bytes = fs.readFileSync(path.join(MIGRATIONS, filename));
      const exactLf = db.canonicalizeMigrationChecksumBytes(bytes);
      expect(exactLf.includes(0x0d)).toBe(false);
      expect(crypto.createHash('sha256').update(exactLf).digest('hex'))
        .toBe(db.loadMigrations(MIGRATIONS).find(item => item.file === filename).digest);
    }
    const phase6dBytes = fs.readFileSync(path.join(MIGRATIONS, MAP_MIGRATION));
    expect(phase6dBytes.includes(0x0d)).toBe(false);
    expect(phase6dBytes[phase6dBytes.length - 1]).toBe(0x0a);
    expect(db.loadMigrations(MIGRATIONS).map(item => item.file)).toEqual(corpus);
    expect(await db.runMigrations({ pool, migrationsDirectory: preMapDirectory })).toBe(true);

    const organizationA = '6a100000-0000-4000-8000-000000000001';
    const organizationB = '6a100000-0000-4000-8000-000000000002';
    const ownerA = '6a200000-0000-4000-8000-000000000001';
    const ownerB = '6a200000-0000-4000-8000-000000000002';
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1,'Map upgrade tenant A','map-upgrade-a@example.test')`,
      [organizationA]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1,$2,'Map owner A','map-owner-a@example.test','not-used','owner','active')`,
      [ownerA, organizationA]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$1,'owner','active')`,
      [ownerA, organizationA]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,$2::jsonb)`,
      [organizationA, JSON.stringify({
        maps: {
          defaultProvider: 'legacy-must-not-import',
          google_maps: { enabled: false, visible: false },
        },
        hostile: '<img src=x onerror=never()>',
      })]
    );
    await pool.query(
      `INSERT INTO notification_preferences
         (organization_id, notification_email, notification_phone)
       VALUES ($1,'private-map-upgrade@example.test','+15555550180')`,
      [organizationA]
    );
    expect((await pool.query(
      `SELECT to_regclass('public.organization_map_preferences') AS organization_authority,
              to_regclass('public.user_map_preferences') AS user_authority`
    )).rows).toEqual([{ organization_authority: null, user_authority: null }]);

    const protectedBefore = {
      account: await rawDigest(pool, 'organization_account_preferences', 'organization_id'),
      notification: await rawDigest(pool, 'notification_preferences', 'organization_id'),
    };
    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);

    const identity = (await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums,
              current_setting('listen_addresses') AS listen_addresses,
              inet_server_port() AS port`
    )).rows[0];
    expect(identity).toEqual({
      version: '18.4', timezone: 'UTC', checksums: 'on', listen_addresses: '127.0.0.1',
      port: Number(process.env.M19_EXPECTED_PG_PORT),
    });
    expect({
      account: await rawDigest(pool, 'organization_account_preferences', 'organization_id'),
      notification: await rawDigest(pool, 'notification_preferences', 'organization_id'),
    }).toEqual(protectedBefore);

    const organizationColumns = (await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'organization_map_preferences'
        ORDER BY ordinal_position`
    )).rows.map(row => row.column_name);
    expect(organizationColumns).toEqual([
      'organization_id', 'google_maps_enabled', 'google_maps_visible',
      'apple_maps_enabled', 'apple_maps_visible', 'waze_enabled', 'waze_visible',
      'default_provider', 'version', 'authority_source', 'updated_by_user_id',
      'created_at', 'updated_at',
    ]);
    const userColumns = (await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_map_preferences'
        ORDER BY ordinal_position`
    )).rows.map(row => row.column_name);
    expect(userColumns).toEqual([
      'organization_id', 'user_id', 'mode', 'google_maps_enabled', 'google_maps_visible',
      'apple_maps_enabled', 'apple_maps_visible', 'waze_enabled', 'waze_visible',
      'default_provider', 'version', 'updated_by_user_id', 'created_at', 'updated_at',
    ]);
    expect((await pool.query(
      `SELECT organization_id, google_maps_enabled, google_maps_visible,
              apple_maps_enabled, apple_maps_visible, waze_enabled, waze_visible,
              default_provider, version, authority_source, updated_by_user_id
         FROM organization_map_preferences WHERE organization_id = $1`,
      [organizationA]
    )).rows).toEqual([{
      organization_id: organizationA,
      google_maps_enabled: true, google_maps_visible: true,
      apple_maps_enabled: true, apple_maps_visible: true,
      waze_enabled: true, waze_visible: true,
      default_provider: 'google_maps', version: '1',
      authority_source: 'system_default', updated_by_user_id: null,
    }]);
    expect((await pool.query('SELECT count(*)::int AS count FROM user_map_preferences')).rows)
      .toEqual([{ count: 0 }]);

    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1,'Map upgrade tenant B','map-upgrade-b@example.test')`,
      [organizationB]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1,$2,'Map owner B','map-owner-b@example.test','not-used','owner','active')`,
      [ownerB, organizationB]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$1,'owner','active')`,
      [ownerB, organizationB]
    );
    expect((await pool.query(
      `SELECT default_provider, version, authority_source
         FROM organization_map_preferences WHERE organization_id = $1`,
      [organizationB]
    )).rows).toEqual([{
      default_provider: 'google_maps', version: '1', authority_source: 'system_default',
    }]);

    await expect(pool.query(
      `UPDATE organization_map_preferences
          SET google_maps_enabled = FALSE, apple_maps_enabled = FALSE, waze_enabled = FALSE
        WHERE organization_id = $1`,
      [organizationA]
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      `UPDATE organization_map_preferences
          SET google_maps_enabled = FALSE, default_provider = 'google_maps'
        WHERE organization_id = $1`,
      [organizationA]
    )).rejects.toMatchObject({ code: '23514', constraint: 'organization_map_preferences_default_check' });
    await expect(pool.query(
      `UPDATE organization_map_preferences
          SET authority_source = 'user', updated_by_user_id = NULL
        WHERE organization_id = $1`,
      [organizationA]
    )).rejects.toMatchObject({ code: '23514', constraint: 'organization_map_preferences_source_check' });
    await expect(pool.query(
      `UPDATE organization_map_preferences
          SET authority_source = 'user', updated_by_user_id = $2
        WHERE organization_id = $1`,
      [organizationA, ownerB]
    )).rejects.toMatchObject({ code: '23503', constraint: 'organization_map_preferences_actor_fk' });

    await expect(pool.query(
      `INSERT INTO user_map_preferences
         (organization_id, user_id, mode, google_maps_enabled, updated_by_user_id)
       VALUES ($1,$2,'inherit',TRUE,$2)`,
      [organizationA, ownerA]
    )).rejects.toMatchObject({ code: '23514', constraint: 'user_map_preferences_document_check' });
    await expect(pool.query(
      `INSERT INTO user_map_preferences (
         organization_id, user_id, mode,
         google_maps_enabled, google_maps_visible,
         apple_maps_enabled, apple_maps_visible,
         waze_enabled, waze_visible, default_provider, updated_by_user_id
       ) VALUES ($1,$2,'override',FALSE,TRUE,TRUE,TRUE,TRUE,TRUE,'google_maps',$2)`,
      [organizationA, ownerA]
    )).rejects.toMatchObject({ code: '23514', constraint: 'user_map_preferences_document_check' });
    await expect(pool.query(
      `INSERT INTO user_map_preferences
         (organization_id, user_id, mode, updated_by_user_id)
       VALUES ($1,$2,'inherit',$3)`,
      [organizationA, ownerA, ownerB]
    )).rejects.toMatchObject({ code: '23514', constraint: 'user_map_preferences_self_actor_check' });
    await pool.query(
      `INSERT INTO user_map_preferences
         (organization_id, user_id, mode, updated_by_user_id)
       VALUES ($1,$2,'inherit',$2)`,
      [organizationA, ownerA]
    );
    expect((await pool.query(
      `SELECT mode, google_maps_enabled, google_maps_visible, default_provider,
              version, updated_by_user_id
         FROM user_map_preferences WHERE organization_id = $1 AND user_id = $2`,
      [organizationA, ownerA]
    )).rows).toEqual([{
      mode: 'inherit', google_maps_enabled: null, google_maps_visible: null,
      default_provider: null, version: '1', updated_by_user_id: ownerA,
    }]);

    const invalidConstraints = await pool.query(
      `SELECT count(*)::int AS count FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND (conname LIKE 'organization_map_preferences_%' OR conname LIKE 'user_map_preferences_%')
          AND NOT convalidated`
    );
    expect(invalidConstraints.rows).toEqual([{ count: 0 }]);
    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);
    const migration = db.loadMigrations(MIGRATIONS).find(item => item.file === MAP_MIGRATION);
    expect((await pool.query(
      `SELECT trim(checksum) AS checksum FROM _migrations WHERE filename = $1`,
      [MAP_MIGRATION]
    )).rows).toEqual([{ checksum: migration.digest }]);
  }, 60000);
});
