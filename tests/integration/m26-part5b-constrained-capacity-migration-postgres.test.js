'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 5B migration224 to constrained capacity v1', () => {
  let database; let pool; let migrationDirectory;
  const db = require('../../src/db');
  const runtimeRole = 'northstar_p5b_runtime';

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p5b-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 3 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p5b-pre225-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 224))
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end(); if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`); } finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p5b-pre225-'))
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
  }, 120000);

  test('applies only migration225 and leaves accepted Part5A entry byte-identical', async () => {
    const signature = async () => (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)'::regprocedure) origin,
      pg_get_functiondef('canonical_forecast_workload_capacity_v1_evaluation_capture(uuid,uuid,text,uuid,text,text,uuid)'::regprocedure) evaluation`)).rows[0];
    const before = await signature(); const filename = '225_canonical_forecast_constrained_capacity_v1.sql';
    fs.copyFileSync(path.resolve(__dirname, '../../migrations', filename), path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory })).resolves.toBe(true);
    const client = await pool.connect();
    try { await client.query('BEGIN');
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { migrationRole: 'postgres', runtimeRole })).resolves.toBeUndefined();
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    expect(await signature()).toEqual(before);
    expect((await pool.query("SELECT filename FROM _migrations WHERE filename LIKE '224_%' OR filename LIKE '225_%' ORDER BY filename"))
      .rows.map(row => row.filename)).toEqual(['224_canonical_forecast_workload_capacity_v1.sql', filename]);
  }, 120000);

  test('grants only guarded entries and keeps private tables, sequence and helpers denied', async () => {
    const row = (await pool.query(`SELECT
      has_table_privilege($1,'canonical_forecast_constrained_capacity_origins_v1','SELECT') runtime_table,
      has_table_privilege($1,'canonical_forecast_constrained_capacity_source_fences_v1','SELECT') runtime_fence,
      has_sequence_privilege($1,'canonical_forecast_constrained_capacity_source_order_v1','USAGE') runtime_sequence,
      has_function_privilege('public','canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)','EXECUTE') public_entry,
      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)','EXECUTE') runtime_entry,
      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_source_identity(uuid,text,text,uuid,jsonb)','EXECUTE') runtime_helper,
      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_definition_valid(text,jsonb)','EXECUTE') runtime_validator,
      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_origin_projection(canonical_forecast_constrained_capacity_origins_v1,text,boolean)','EXECUTE') runtime_projection,
      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_complete_input(uuid,timestamptz,timestamptz)','EXECUTE') runtime_input,
	      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb)','EXECUTE') runtime_results,
	      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_scope_population_valid(uuid,jsonb,timestamptz,timestamptz)','EXECUTE') runtime_scope_population,
	      has_function_privilege($1,'canonical_forecast_constrained_capacity_v1_source_capture()','EXECUTE') runtime_trigger`,
    [runtimeRole])).rows[0];
    expect(row).toEqual({ runtime_table: false, runtime_fence: false, runtime_sequence: false, public_entry: false,
      runtime_entry: true, runtime_helper: false, runtime_validator: false, runtime_projection: false,
	      runtime_input: false, runtime_results: false, runtime_scope_population: false,
      runtime_trigger: false });
    expect((await pool.query(`SELECT count(*)::integer count FROM pg_trigger WHERE NOT tgisinternal
      AND tgenabled='O' AND tgfoid='canonical_forecast_constrained_capacity_v1_immutable()'::regprocedure`))
      .rows[0].count).toBe(7);
    expect((await pool.query(`SELECT count(*)::integer count FROM pg_trigger WHERE NOT tgisinternal
      AND tgenabled='O' AND tgfoid='canonical_forecast_constrained_capacity_v1_source_capture()'::regprocedure`))
      .rows[0].count).toBe(19);
  });

  test('fails startup closed for missing entry, unsafe helper and disabled source or immutable trigger', async () => {
    const fail = async (sql, message) => { const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query(sql);
        await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
          { migrationRole: 'postgres', runtimeRole })).rejects.toThrow(message);
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); } };
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_origin_read(uuid,uuid,text,uuid,uuid)
      RENAME TO canonical_forecast_constrained_capacity_v1_origin_read_missing`,
    'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_source_identity(uuid,text,text,uuid,jsonb)
      SECURITY INVOKER`, 'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_lock_sources(uuid)
      SET search_path TO public`, 'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_complete_input(uuid,timestamptz,timestamptz)
      SECURITY INVOKER`, 'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_results(uuid,timestamptz,timestamptz,timestamptz,jsonb)
      SET search_path TO public`, 'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_source_baseline(uuid,timestamptz)
      SECURITY INVOKER`, 'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_scope_segment(
      uuid,canonical_forecast_constrained_capacity_reviews_v1,timestamptz,timestamptz,jsonb,text)
      SET search_path TO public`, 'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_schedule_timeline(
      uuid,uuid,timestamptz,timestamptz,timestamptz,boolean) SECURITY INVOKER`,
    'Required constrained-capacity v1 entry security is missing');
	    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_review_at(uuid,text,text,uuid,timestamptz)
	      SECURITY INVOKER`, 'Required constrained-capacity v1 entry security is missing');
	    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_scope_population_valid(
	      uuid,jsonb,timestamptz,timestamptz) SET search_path TO public`,
	    'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_job_review_covers(
      uuid,canonical_forecast_constrained_capacity_reviews_v1,timestamptz) SECURITY INVOKER`,
    'Required constrained-capacity v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_constrained_capacity_v1_origin_projection(
      canonical_forecast_constrained_capacity_origins_v1,text,boolean) SECURITY DEFINER`,
    'Required constrained-capacity v1 projection security is missing');
    await fail(`ALTER TABLE canonical_forecast_constrained_capacity_origins_v1 DISABLE TRIGGER
      z_m26_p5b_immutable_origins`, 'Required constrained-capacity v1 immutability is missing');
    await fail(`ALTER TABLE workforce_crews DISABLE TRIGGER z_m26_p5b_source_crews`,
      'Required constrained-capacity v1 source capture is missing');
    await fail(`ALTER TABLE canonical_estimates DISABLE TRIGGER z_m26_p5b_source_estimates`,
      'Required constrained-capacity v1 source capture is missing');
    await fail(`ALTER TABLE canonical_completion_records DISABLE TRIGGER z_m26_p5b_source_completion_records`,
      'Required constrained-capacity v1 source capture is missing');
  }, 120000);

  test('keeps the half-open future horizon at exactly 2,592,000 elapsed seconds through DST', async () => {
    const value = (await pool.query(`WITH boundary AS (SELECT timestamptz '2027-03-13 12:00:00-05' cutoff)
      SELECT extract(epoch FROM((cutoff+interval '2592000 seconds')-cutoff))::bigint seconds,
      to_char(cutoff AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI') local_start,
      to_char((cutoff+interval '2592000 seconds') AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI') local_end FROM boundary`)).rows[0];
    expect(value).toEqual({ seconds: '2592000', local_start: '2027-03-13 12:00',
      local_end: '2027-04-12 13:00' });
  });
});
