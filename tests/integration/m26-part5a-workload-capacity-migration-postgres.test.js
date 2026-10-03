'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 5A migration223 to workload-capacity v1', () => {
  let database; let pool; let migrationDirectory;
  const db = require('../../src/db');
  const runtimeRole = 'northstar_p5a_runtime';

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p5a-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 3 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p5a-pre224-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 223)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`); } finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p5a-pre224-')) {
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  }, 120000);

  test('adds only migration224 and leaves accepted Part4C entries byte-identical', async () => {
    const signature = async () => (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_seasonal_origin_v1_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure) seasonal,
      pg_get_functiondef('canonical_forecast_pipeline_origin_v1_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) pipeline,
      pg_get_functiondef('canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid)'::regprocedure) ui`)).rows[0];
    const before = await signature();
    const filename = '224_canonical_forecast_workload_capacity_v1.sql';
    fs.copyFileSync(path.resolve(__dirname, '../../migrations', filename),
      path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory })).resolves.toBe(true);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { migrationRole: 'postgres', runtimeRole })).resolves.toBeUndefined();
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    expect(await signature()).toEqual(before);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE filename LIKE '223_%' OR filename LIKE '224_%' ORDER BY filename`))
      .rows.map(row => row.filename)).toEqual([
      '223_canonical_forecast_demand_ui_prerequisites_v1.sql', filename,
    ]);
  }, 120000);

  test('grants runtime only guarded entries and keeps every table/helper private', async () => {
    const row = (await pool.query(`SELECT
      has_table_privilege($1,'canonical_forecast_workload_capacity_origins_v1','SELECT') runtime_table,
      has_table_privilege($1,'canonical_forecast_workload_capacity_role_generations_v1','SELECT') runtime_generation,
      has_table_privilege($1,'canonical_forecast_workload_capacity_availability_events_v1','SELECT') runtime_availability_events,
      has_table_privilege($1,'canonical_forecast_workload_capacity_profile_events_v1','SELECT') runtime_profile_events,
      has_function_privilege('public','canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)','EXECUTE') public_entry,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)','EXECUTE') runtime_entry,
      has_function_privilege('public','canonical_forecast_workload_capacity_v1_backlog_unschedule(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text,text)','EXECUTE') public_unschedule,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_backlog_unschedule(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text,text)','EXECUTE') runtime_unschedule,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_origin_input(uuid,timestamptz,timestamptz)','EXECUTE') runtime_helper,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_access_recheck(uuid,uuid,text,uuid,text,boolean)','EXECUTE') runtime_access_recheck,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_test_clock_set(timestamptz)','EXECUTE') runtime_clock,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_completion_clock()','EXECUTE') runtime_source_clock,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_schedule_clock()','EXECUTE') runtime_schedule_clock,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_schedule_revision_clock()','EXECUTE') runtime_schedule_revision_clock,
      has_function_privilege($1,'canonical_forecast_workload_capacity_v1_person_plan_clock()','EXECUTE') runtime_person_plan_clock,
      has_function_privilege($1,'canonical_field_execution_validate_complete()','EXECUTE') runtime_field_validator,
      has_function_privilege($1,'canonical_labor_validate_complete()','EXECUTE') runtime_labor_validator,
      has_function_privilege($1,'canonical_completion_validate_complete()','EXECUTE') runtime_completion_validator,
      (SELECT bool_and(prosecdef AND COALESCE(proconfig,'{}'::text[]) @>
        ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) FROM pg_proc WHERE oid IN(
        'canonical_field_execution_validate_complete()'::regprocedure,
        'canonical_labor_validate_complete()'::regprocedure,
        'canonical_completion_validate_complete()'::regprocedure)) deferred_validators_safe`,
    [runtimeRole])).rows[0];
    expect(row).toEqual({ runtime_table: false, runtime_generation: false,
      runtime_availability_events: false, runtime_profile_events: false,
      public_entry: false, runtime_entry: true,
      public_unschedule: false, runtime_unschedule: true,
      runtime_helper: false, runtime_access_recheck: false, runtime_clock: false, runtime_source_clock: false,
      runtime_schedule_clock: false, runtime_schedule_revision_clock: false,
      runtime_person_plan_clock: false,
      runtime_field_validator: false, runtime_labor_validator: false,
      runtime_completion_validator: false, deferred_validators_safe: true });
    expect((await pool.query(`SELECT count(*)::integer count FROM pg_trigger
      WHERE NOT tgisinternal AND tgenabled='O' AND tgtype=58
       AND tgfoid='canonical_forecast_workload_capacity_v1_immutable()'::regprocedure`))
      .rows[0].count).toBe(10);
  }, 120000);

  test('keeps the fixed horizon at exactly 2,592,000 seconds across New York DST', async () => {
    const value = (await pool.query(`WITH boundary AS (
      SELECT timestamptz '2027-03-13 12:00:00-05' AS cutoff
    ) SELECT extract(epoch FROM((cutoff+interval '2592000 seconds')-cutoff))::bigint seconds,
      to_char(cutoff AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI') local_start,
      to_char((cutoff+interval '2592000 seconds') AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI') local_end
      FROM boundary`)).rows[0];
    expect(value).toEqual({ seconds: '2592000', local_start: '2027-03-13 12:00',
      local_end: '2027-04-12 13:00' });
  });

  test('startup fails closed for missing entry, unsafe definer or disabled immutability', async () => {
    const fail = async (sql, message) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query(sql);
        await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
          { migrationRole: 'postgres', runtimeRole })).rejects.toThrow(message);
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    };
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid)
      RENAME TO canonical_forecast_workload_capacity_v1_origin_read_missing`,
    'Required workload-capacity v1 authority is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)
      SECURITY INVOKER`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_backlog_unschedule(uuid,uuid,text,uuid,text,text,uuid,bigint,text,text,text)
      RENAME TO canonical_forecast_workload_capacity_v1_backlog_unschedule_missing`,
    'Required workload-capacity v1 authority is missing');
    await fail(`ALTER FUNCTION canonical_completion_validate_complete() SECURITY INVOKER`,
      'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_access_recheck(uuid,uuid,text,uuid,text,boolean)
      SECURITY INVOKER`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_source_fence()
      SECURITY INVOKER`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_lock_sources(uuid)
      SET search_path TO public`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_clock()
      SECURITY INVOKER`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_completion_clock()
      SET search_path TO public`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_schedule_clock()
      SECURITY INVOKER`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_schedule_revision_clock()
      SET search_path TO public`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_workload_capacity_v1_person_plan_clock()
      SECURITY INVOKER`, 'Required workload-capacity v1 entry security is missing');
    await fail(`ALTER TABLE canonical_forecast_workload_capacity_availability_events_v1 DISABLE TRIGGER
      z_m26_p5a_availability_events_immutable`,
      'Required workload-capacity v1 availability history immutability is missing');
    await fail(`ALTER TABLE canonical_forecast_workload_capacity_profile_events_v1 DISABLE TRIGGER
      z_m26_p5a_profile_events_immutable`,
      'Required workload-capacity v1 profile history immutability is missing');
    await fail(`ALTER TABLE canonical_work_profile_events DISABLE TRIGGER
      z_m26_p5a_fence_work_profiles`,
      'Required workload-capacity v1 source fence is missing');
    await fail(`ALTER TABLE canonical_forecast_workload_capacity_evaluations_v1 DISABLE TRIGGER
      canonical_forecast_workload_capacity_evaluations_v1_immutable`,
    'Required workload-capacity v1 immutability is missing');
    await fail(`ALTER TABLE canonical_labor_intervals DISABLE TRIGGER
      z_m26_p5a_fence_labor_intervals`,
    'Required workload-capacity v1 source fence is missing');
    await fail(`ALTER TABLE canonical_forecast_workload_capacity_role_generations_v1
      RENAME TO canonical_forecast_workload_capacity_role_generations_v1_missing`,
      'Required workload-capacity v1 authority is missing');
    await fail(`ALTER TABLE canonical_completion_records DISABLE TRIGGER
      z_m26_p5a_disposable_completion_clock`,
    'Required workload-capacity disposable source clock is missing');
    await fail(`ALTER TABLE canonical_schedule_approvals DISABLE TRIGGER
      z_m26_p5a_disposable_schedule_approval_clock`,
    'Required workload-capacity disposable source clock is missing');
    await fail(`ALTER TABLE canonical_schedule_human_approvals DISABLE TRIGGER
      z_m26_p5a_disposable_human_approval_clock`,
    'Required workload-capacity disposable source clock is missing');
    await fail(`ALTER TABLE canonical_schedule_assignment_revisions DISABLE TRIGGER
      z_m26_p5a_disposable_schedule_revision_clock`,
    'Required workload-capacity disposable source clock is missing');
    await fail(`ALTER TABLE canonical_forecast_current_backlog_person_plan_reviews DISABLE TRIGGER
      z_m26_p5a_disposable_person_plan_clock`,
    'Required workload-capacity disposable source clock is missing');
  }, 120000);
});
