'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');

realPostgres('Mission 20 Part 2F tenant asset catalogue migration', () => {
  let suiteDatabase;
  let pool;
  let preAssetDirectory;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2f-asset-migration');
    pool = new Pool({ connectionString: suiteDatabase.connectionString });
    preAssetDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-p2f-pre-'));
    for (const filename of fs.readdirSync(MIGRATIONS)
      .filter(name => /^\d+.*\.sql$/.test(name) && name !== '016_tenant_asset_catalogue.sql')) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preAssetDirectory, filename));
    }
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (preAssetDirectory && path.resolve(preAssetDirectory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(preAssetDirectory, { recursive: true, force: true });
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('adds identity-only authority without inventing assets from legacy profile assumptions', async () => {
    jest.resetModules();
    const db = require('../../src/db');
    expect(await db.runMigrations({ pool, migrationsDirectory: preAssetDirectory })).toBe(true);

    const organization = '81000000-0000-4000-8000-000000000001';
    const actor = '82000000-0000-4000-8000-000000000001';
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1,'Asset Migration Organization','asset-migration@example.test')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1,$2,'Asset Owner','asset-owner@example.test','not-used','owner','active')`,
      [actor, organization]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$1,'owner','active')`,
      [actor, organization]
    );
    const profile = canonicalFenceProfile({ companyName: 'Asset Migration Organization' });
    profile.vehicles = {
      truckCount: 11, trailerCount: 7, averageMpg: 13, averageFuelCost: 4,
      hourlyVehicleCost: 21, maintenanceReserve: 0.08, equipmentTransportCapacity: 4,
    };
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const storedProfile = await putBusinessProfile(pool, {
      organizationId: organization, userId: actor, expectedVersion: null, profile,
    });

    expect((await pool.query("SELECT to_regclass('public.tenant_assets') AS authority")).rows[0].authority)
      .toBeNull();
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

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenant_assets'
        ORDER BY ordinal_position`
    );
    expect(columns.rows.map(row => row.column_name)).toEqual([
      'id', 'organization_id', 'category', 'name', 'internal_reference', 'manufacturer',
      'model', 'model_year', 'configuration', 'serial_number', 'vin', 'home_location_id',
      'catalogue_state', 'version', 'created_by_user_id', 'updated_by_user_id',
      'archived_by_user_id', 'created_at', 'updated_at', 'archived_at',
    ]);

    const tables = await pool.query(
      `SELECT to_regclass('public.tenant_assets') AS assets,
              to_regclass('public.tenant_asset_service_capabilities') AS service_capabilities,
              to_regclass('public.tenant_asset_audit_events') AS audit_events,
              to_regclass('public.tenant_asset_assignments') AS assignments,
              to_regclass('public.tenant_asset_meter_readings') AS meter_readings,
              to_regclass('public.tenant_asset_maintenance') AS maintenance,
              to_regclass('public.tenant_asset_provider_mappings') AS provider_mappings,
              to_regclass('public.tenant_asset_sync_state') AS sync_state`
    );
    expect(tables.rows).toEqual([{
      assets: 'tenant_assets',
      service_capabilities: 'tenant_asset_service_capabilities',
      audit_events: 'tenant_asset_audit_events',
      assignments: null,
      meter_readings: null,
      maintenance: null,
      provider_mappings: null,
      sync_state: null,
    }]);

    const forbiddenColumns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tenant_assets'
          AND column_name = ANY($1::text[]) ORDER BY column_name`,
      [[
        'assigned_crew_id', 'assignment_id', 'availability', 'condition', 'current_location_id',
        'current_value', 'downtime', 'hours', 'mileage', 'operating_cost', 'provider_mapping',
        'purchase_cost', 'sync_state', 'telematics',
      ]]
    );
    expect(forbiddenColumns.rows).toEqual([]);

    const catalog = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM tenant_assets) AS assets,
         (SELECT count(*)::int FROM tenant_asset_service_capabilities) AS capabilities,
         (SELECT count(*)::int FROM tenant_asset_audit_events) AS audit_events,
         (SELECT count(*)::int FROM pg_constraint
           WHERE connamespace = 'public'::regnamespace
             AND conname LIKE 'tenant_asset_%' AND NOT convalidated) AS unvalidated_constraints,
         (SELECT count(*)::int FROM pg_index index_record
           JOIN pg_class table_record ON table_record.oid = index_record.indrelid
          WHERE table_record.relname LIKE 'tenant_asset%'
            AND (NOT index_record.indisvalid OR NOT index_record.indisready)) AS invalid_indexes`
    );
    expect(catalog.rows).toEqual([{
      assets: 0, capabilities: 0, audit_events: 0,
      unvalidated_constraints: 0, invalid_indexes: 0,
    }]);
    expect((await pool.query(
      `SELECT raw_profile->'vehicles' AS vehicles FROM canonical_business_profiles
        WHERE organization_id = $1 AND id = $2`,
      [organization, storedProfile.id]
    )).rows).toEqual([{ vehicles: profile.vehicles }]);

    await expect(pool.query(
      `INSERT INTO tenant_assets
        (organization_id, category, name, catalogue_state, version,
         created_by_user_id, updated_by_user_id)
       VALUES ($1,'equipment','Invalid state','available',1,$2,$2)`,
      [organization, actor]
    )).rejects.toMatchObject({ code: '23514', constraint: 'tenant_assets_state_check' });
    await expect(pool.query(
      `INSERT INTO tenant_assets
        (organization_id, category, name, catalogue_state, version,
         created_by_user_id, updated_by_user_id)
       VALUES ($1,'equipment','Invalid version','active',0,$2,$2)`,
      [organization, actor]
    )).rejects.toMatchObject({ code: '23514', constraint: 'tenant_assets_version_check' });
    await expect(pool.query(
      `INSERT INTO tenant_assets
        (organization_id, category, name, created_by_user_id, updated_by_user_id)
       VALUES ($1,'equipment',$3,$2,$2)`,
      [organization, actor, ' '.repeat(120) + 'x']
    )).rejects.toMatchObject({ code: '23514', constraint: 'tenant_assets_name_check' });

    expect(await db.runMigrations({ pool, migrationsDirectory: MIGRATIONS })).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS count FROM tenant_assets')).rows)
      .toEqual([{ count: 0 }]);
    const migration = db.loadMigrations(MIGRATIONS)
      .find(item => item.file === '016_tenant_asset_catalogue.sql');
    expect((await pool.query(
      `SELECT trim(checksum) AS checksum FROM _migrations
        WHERE filename = '016_tenant_asset_catalogue.sql'`
    )).rows).toEqual([{ checksum: migration.digest }]);
  }, 60000);
});
