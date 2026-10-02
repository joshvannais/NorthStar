'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 4A migration 219 to 220 rolling upgrade', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p4a-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(),
      'northstar-m26-p4a-pre220-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 219)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query('CREATE ROLE northstar_app_runtime NOLOGIN');
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query('DROP ROLE IF EXISTS northstar_app_runtime'); }
    finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p4a-pre220-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('adds only the Retell v2 period and future-origin authority', async () => {
    const before = (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_retell_call_snapshot_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) snapshot_capture,
      pg_get_functiondef('canonical_forecast_retell_call_reviews_read(uuid,uuid,text,uuid,uuid)'::regprocedure) review_read,
      pg_get_functiondef('canonical_forecast_profile_month_guarded_source(uuid,uuid,text,uuid,date)'::regprocedure) profile_read`)).rows[0];
    const source = path.resolve(__dirname, '../../migrations');
    const filename = '220_canonical_forecast_retell_future_origin_v2.sql';
    fs.copyFileSync(path.join(source, filename), path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
      .resolves.toBe(true);
    const after = (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_retell_call_snapshot_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) snapshot_capture,
      pg_get_functiondef('canonical_forecast_retell_call_reviews_read(uuid,uuid,text,uuid,uuid)'::regprocedure) review_read,
      pg_get_functiondef('canonical_forecast_profile_month_guarded_source(uuid,uuid,text,uuid,date)'::regprocedure) profile_read`)).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE filename LIKE '21%_canonical%' OR filename LIKE '220_%'
      ORDER BY filename`)).rows.map(row => row.filename).slice(-11)).toEqual([
      '210_canonical_forecast_current_backlog_composition_marker.sql',
      '211_canonical_forecast_approved_estimate_asof_v2.sql',
      '212_canonical_forecast_comparable_months_v2.sql',
      '213_canonical_forecast_approved_estimate_lineage_replay_v2.sql',
      '214_canonical_forecast_complete_window_evaluation_v2.sql',
      '215_canonical_forecast_complete_window_measurement_v2.sql',
      '216_canonical_forecast_complete_window_measurement_drift_gate.sql',
      '217_canonical_forecast_complete_window_measurement_tenant_identity.sql',
      '218_canonical_forecast_complete_window_governance_v2.sql',
      '219_canonical_forecast_complete_window_governance_metrics.sql',
      filename,
    ]);
  }, 120000);

  test('keeps tables and helpers private while granting only guarded entries', async () => {
    const result = (await pool.query(`SELECT
      to_regclass('canonical_forecast_retell_period_certifications_v2')::text certifications,
      to_regclass('canonical_forecast_retell_future_origins_v2')::text origins,
      to_regprocedure('canonical_forecast_retell_period_snapshot_v2_capture(uuid,uuid,text,uuid,text,text,date)')::text period_snapshot_capture,
      to_regprocedure('canonical_forecast_retell_period_certification_v2_read(uuid,uuid,text,uuid,date)')::text certification_read,
      has_table_privilege('northstar_app_runtime',
        'canonical_forecast_retell_period_certifications_v2','SELECT') runtime_cert_table,
      has_table_privilege('northstar_app_runtime',
        'canonical_forecast_retell_future_origins_v2','SELECT') runtime_origin_table,
      has_function_privilege('public',
        'canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)',
        'EXECUTE') public_capture,
      has_function_privilege('northstar_app_runtime',
        'canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)',
        'EXECUTE') runtime_capture,
      has_function_privilege('northstar_app_runtime',
        'canonical_forecast_retell_future_evidence_v2(uuid,uuid,text,uuid,date)',
        'EXECUTE') runtime_helper,
      has_function_privilege('northstar_app_runtime',
        'canonical_forecast_retell_period_snapshot_v2_capture(uuid,uuid,text,uuid,text,text,date)',
        'EXECUTE') runtime_period_capture,
      has_function_privilege('northstar_app_runtime',
        'canonical_forecast_retell_period_certification_v2_read(uuid,uuid,text,uuid,date)',
        'EXECUTE') runtime_certification_read,
      has_function_privilege('northstar_app_runtime',
        'canonical_forecast_retell_call_window_pins(uuid,timestamptz,timestamptz,timestamptz)',
        'EXECUTE') runtime_window_helper`)).rows[0];
    expect(result).toEqual({ certifications: 'canonical_forecast_retell_period_certifications_v2',
      origins: 'canonical_forecast_retell_future_origins_v2',
      period_snapshot_capture:
        'canonical_forecast_retell_period_snapshot_v2_capture(uuid,uuid,text,uuid,text,text,date)',
      certification_read:
        'canonical_forecast_retell_period_certification_v2_read(uuid,uuid,text,uuid,date)',
      runtime_cert_table: false, runtime_origin_table: false,
      public_capture: false, runtime_capture: true, runtime_helper: false,
      runtime_period_capture: true, runtime_certification_read: true,
      runtime_window_helper: false });
    expect((await pool.query(`SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid IN (
       'canonical_forecast_retell_period_certifications_v2'::regclass,
       'canonical_forecast_retell_future_origins_v2'::regclass)
      ORDER BY tgname`)).rows.map(row => row.tgname)).toEqual([
      'canonical_forecast_retell_future_origins_v2_immutable',
      'canonical_forecast_retell_period_certifications_v2_immutable',
    ]);
  }, 120000);

  test('fails startup verification when the installed authority is missing', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`ALTER FUNCTION
        canonical_forecast_retell_future_evidence_v2(uuid,uuid,text,uuid,date)
        RENAME TO canonical_forecast_retell_future_evidence_v2_missing`);
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { runtimeRole: 'northstar_app_runtime' }))
        .rejects.toThrow('Required Retell future-origin v2 authority is missing');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }, 120000);
});
