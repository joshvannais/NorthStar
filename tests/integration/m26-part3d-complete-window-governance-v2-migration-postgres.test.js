'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 3D migration 217 to 218 rolling upgrade', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p3d-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(),
      'northstar-m26-p3d-pre218-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 217)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query('CREATE ROLE northstar_app_runtime NOLOGIN');
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL,
      max: 1 });
    try { await admin.query('DROP ROLE IF EXISTS northstar_app_runtime'); }
    finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p3d-pre218-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('adds only governance v2 while preserving migrations 184 through 217',
    async () => {
      const before = (await pool.query(`SELECT
       pg_get_functiondef('canonical_forecast_price_flow_matched_population(uuid,uuid,text,uuid,boolean)'::regprocedure) population,
       pg_get_functiondef('canonical_forecast_price_flow_supported_experiment_review(uuid,uuid,text,uuid,uuid)'::regprocedure) supported_review,
       pg_get_functiondef('canonical_forecast_price_flow_method_eligibility(uuid,uuid,text,uuid,uuid,text)'::regprocedure) method,
       pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) evaluation,
       pg_get_functiondef('canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)'::regprocedure) measurement`)).rows[0];
      const oldClosureBefore = (await pool.query(`SELECT
       public.canonical_forecast_price_flow_method_closure_current() current`))
        .rows[0].current;
      // Migration 214 legitimately extended registered-origin writers after the
      // migration-201 review. The immutable v1 registration must therefore
      // remain unavailable rather than being silently rewritten by v2.
      expect(oldClosureBefore).toBe(false);
      const source = path.resolve(__dirname, '../../migrations');
      const filename = '218_canonical_forecast_complete_window_governance_v2.sql';
      fs.copyFileSync(path.join(source, filename),
        path.join(migrationDirectory, filename));
      expect(await db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
        .toBe(true);
      const after = (await pool.query(`SELECT
       pg_get_functiondef('canonical_forecast_price_flow_matched_population(uuid,uuid,text,uuid,boolean)'::regprocedure) population,
       pg_get_functiondef('canonical_forecast_price_flow_supported_experiment_review(uuid,uuid,text,uuid,uuid)'::regprocedure) supported_review,
       pg_get_functiondef('canonical_forecast_price_flow_method_eligibility(uuid,uuid,text,uuid,uuid,text)'::regprocedure) method,
       pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) evaluation,
       pg_get_functiondef('canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)'::regprocedure) measurement`)).rows[0];
      expect(after).toEqual(before);
      const closuresAfter = (await pool.query(`SELECT
       public.canonical_forecast_price_flow_method_closure_current() old_current,
       m.dependency_closure_digest =
        public.canonical_forecast_price_flow_method_closure_digest() new_current
       FROM public.canonical_forecast_complete_window_governance_methods_v2 m
       WHERE m.version='m26_complete_window_deterministic_closure_v2'`)).rows[0];
      expect(closuresAfter).toEqual({ old_current: false, new_current: true });
      expect((await pool.query(`SELECT filename FROM _migrations
        WHERE filename LIKE '21%_canonical%' ORDER BY filename`)).rows
        .map(row => row.filename).slice(-9)).toEqual([
        '210_canonical_forecast_current_backlog_composition_marker.sql',
        '211_canonical_forecast_approved_estimate_asof_v2.sql',
        '212_canonical_forecast_comparable_months_v2.sql',
        '213_canonical_forecast_approved_estimate_lineage_replay_v2.sql',
        '214_canonical_forecast_complete_window_evaluation_v2.sql',
        '215_canonical_forecast_complete_window_measurement_v2.sql',
        '216_canonical_forecast_complete_window_measurement_drift_gate.sql',
        '217_canonical_forecast_complete_window_measurement_tenant_identity.sql',
        filename,
      ]);
    }, 120000);

  test('installs immutable tenant-private tables and entry-only runtime authority',
    async () => {
      const result = (await pool.query(`SELECT
       to_regclass('canonical_forecast_complete_window_governance_reviews_v2')::text reviews,
       to_regclass('canonical_forecast_complete_window_governance_selections_v2')::text selections,
       has_function_privilege('public',
        'canonical_forecast_complete_window_governance_review_v2_capture(uuid,uuid,text,uuid,text,text,uuid)',
        'EXECUTE') public_capture,
       has_function_privilege('public',
        'canonical_forecast_complete_window_governance_evidence_v2(uuid,uuid,text,uuid,uuid)',
        'EXECUTE') public_evidence,
       has_function_privilege('northstar_app_runtime',
        'canonical_forecast_complete_window_governance_review_v2_capture(uuid,uuid,text,uuid,text,text,uuid)',
        'EXECUTE') runtime_capture,
       has_function_privilege('northstar_app_runtime',
        'canonical_forecast_complete_window_governance_evidence_v2(uuid,uuid,text,uuid,uuid)',
        'EXECUTE') runtime_evidence,
       has_table_privilege('northstar_app_runtime',
        'canonical_forecast_complete_window_governance_reviews_v2','SELECT') runtime_table`)).rows[0];
      expect(result).toEqual({
        reviews: 'canonical_forecast_complete_window_governance_reviews_v2',
        selections: 'canonical_forecast_complete_window_governance_selections_v2',
        public_capture: false,
        public_evidence: false,
        runtime_capture: true,
        runtime_evidence: false,
        runtime_table: false,
      });
      const triggers = (await pool.query(`SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN (
          'canonical_forecast_complete_window_governance_reviews_v2'::regclass,
          'canonical_forecast_complete_window_governance_selections_v2'::regclass)
        ORDER BY tgname`)).rows.map(row => row.tgname);
      expect(triggers).toEqual([
        'm26_complete_window_governance_reviews_v2_immutable',
        'm26_complete_window_governance_selections_v2_immutable',
      ]);
    }, 120000);
});
