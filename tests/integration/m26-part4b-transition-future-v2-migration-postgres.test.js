'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 4B migration 220 to transition v2 authority', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p4b-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p4b-pre221-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 220)) {
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
        path.basename(migrationDirectory).startsWith('northstar-m26-p4b-pre221-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('adds only the four-target origin and evaluation authority', async () => {
    const before = (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_lead_qualification_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) qualification,
      pg_get_functiondef('canonical_forecast_estimate_request_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) estimate_request,
      pg_get_functiondef('canonical_forecast_schedule_booking_transition_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) booking,
      pg_get_functiondef('canonical_forecast_schedule_booking_cancellation_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) cancellation`)).rows[0];
    const source = path.resolve(__dirname, '../../migrations');
    const filename = '221_canonical_forecast_transition_future_origins_v2.sql';
    fs.copyFileSync(path.join(source, filename), path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
      .resolves.toBe(true);
    const after = (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_lead_qualification_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) qualification,
      pg_get_functiondef('canonical_forecast_estimate_request_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) estimate_request,
      pg_get_functiondef('canonical_forecast_schedule_booking_transition_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) booking,
      pg_get_functiondef('canonical_forecast_schedule_booking_cancellation_cohort_capture(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure) cancellation`)).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE filename LIKE '220_%' OR filename LIKE '221_%' ORDER BY filename`))
      .rows.map(row => row.filename)).toEqual([
      '220_canonical_forecast_retell_future_origin_v2.sql', filename,
    ]);
  }, 120000);

  test('keeps storage and helpers private and exposes only guarded entries', async () => {
    const result = (await pool.query(`SELECT
      to_regclass('canonical_forecast_transition_coverage_epochs_v2')::text epochs,
      to_regclass('canonical_forecast_transition_methods_v2')::text methods,
      to_regclass('canonical_forecast_transition_method_reviews_v2')::text method_reviews,
      to_regclass('canonical_forecast_transition_future_origins_v2')::text origins,
      to_regclass('canonical_forecast_transition_evaluations_v2')::text evaluations,
      has_table_privilege('northstar_app_runtime',
       'canonical_forecast_transition_future_origins_v2','SELECT') runtime_origin_table,
      has_table_privilege('northstar_app_runtime',
       'canonical_forecast_transition_method_reviews_v2','SELECT') runtime_review_table,
      has_function_privilege('public',
       'canonical_forecast_transition_origin_v2_capture(uuid,uuid,text,uuid,text,text)',
       'EXECUTE') public_capture,
      has_function_privilege('northstar_app_runtime',
       'canonical_forecast_transition_origin_v2_capture(uuid,uuid,text,uuid,text,text)',
       'EXECUTE') runtime_capture,
      has_function_privilege('northstar_app_runtime',
       'canonical_forecast_transition_origin_v2_read(uuid,uuid,text,uuid,uuid)',
       'EXECUTE') runtime_read,
      has_function_privilege('public',
       'canonical_forecast_transition_method_review_v2_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,boolean,text)',
       'EXECUTE') public_method_review,
      has_function_privilege('northstar_app_runtime',
       'canonical_forecast_transition_method_review_v2_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,boolean,text)',
       'EXECUTE') runtime_method_review,
      has_function_privilege('northstar_app_runtime',
       'canonical_forecast_transition_evaluation_v2_capture(uuid,uuid,text,uuid,text,text,uuid)',
       'EXECUTE') runtime_evaluation_capture,
      has_function_privilege('northstar_app_runtime',
       'canonical_forecast_transition_cohort_capture_v2(uuid,uuid,text,uuid,text,text,text,timestamptz,timestamptz)',
       'EXECUTE') runtime_helper,
      has_function_privilege('public',
       'canonical_forecast_transition_clock_v2()','EXECUTE') public_clock,
      has_function_privilege('northstar_app_runtime',
       'canonical_forecast_transition_clock_v2()','EXECUTE') runtime_clock`)).rows[0];
    expect(result).toEqual({
      epochs: 'canonical_forecast_transition_coverage_epochs_v2',
      methods: 'canonical_forecast_transition_methods_v2',
      method_reviews: 'canonical_forecast_transition_method_reviews_v2',
      origins: 'canonical_forecast_transition_future_origins_v2',
      evaluations: 'canonical_forecast_transition_evaluations_v2',
      runtime_origin_table: false, runtime_review_table: false,
      public_capture: false, runtime_capture: true,
      runtime_read: true, public_method_review: false, runtime_method_review: true,
      runtime_evaluation_capture: true, runtime_helper: false,
      public_clock: false, runtime_clock: false,
    });
    expect((await pool.query(`SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal AND tgrelid IN (
       'canonical_forecast_transition_coverage_epochs_v2'::regclass,
       'canonical_forecast_transition_methods_v2'::regclass,
       'canonical_forecast_transition_method_reviews_v2'::regclass,
       'canonical_forecast_transition_future_origins_v2'::regclass,
       'canonical_forecast_transition_evaluations_v2'::regclass)
      ORDER BY tgname`)).rows.map(row => row.tgname)).toEqual([
      'canonical_forecast_transition_epochs_v2_immutable',
      'canonical_forecast_transition_evaluations_v2_immutable',
      'canonical_forecast_transition_method_reviews_v2_immutable',
      'canonical_forecast_transition_methods_v2_immutable',
      'canonical_forecast_transition_origins_v2_immutable',
    ]);
  }, 120000);

  test('runtime verification fails closed when an entry authority is missing', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`ALTER FUNCTION
        canonical_forecast_transition_evaluation_v2_read(uuid,uuid,text,uuid,uuid)
        RENAME TO canonical_forecast_transition_evaluation_v2_read_missing`);
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { runtimeRole: 'northstar_app_runtime' }))
        .rejects.toThrow('Required transition future-origin v2 authority is missing');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }, 120000);
});
