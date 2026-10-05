'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 5D migration226 to corrected capacity UI v7', () => {
  let database; let pool; let migrationDirectory; let originalDefinitions; let originalChecksums;
  const db = require('../../src/db');
  const runtimeRole = `northstar_p5d_runtime_${process.pid}`;

  const definitions = async () => (await pool.query(`SELECT
    pg_get_functiondef('canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)'::regprocedure) workload,
    pg_get_functiondef('canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)'::regprocedure) constrained,
    pg_get_functiondef('canonical_forecast_capacity_advisory_v1_origin_capture_v2(uuid,uuid,text,uuid,text,text,text,text,uuid)'::regprocedure) advisory`)).rows[0];

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p5d-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 1 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p5d-pre228-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 226))
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    originalDefinitions = await definitions();
    originalChecksums = (await pool.query(
      `SELECT filename,checksum FROM _migrations WHERE substring(filename,1,3)::integer<=226 ORDER BY filename`)).rows;
    await pool.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
    await pool.query(`SET northstar.runtime_role='${runtimeRole}'`);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`); } finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p5d-pre228-'))
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
  }, 120000);

  test('adds only migrations227-233 and leaves every migration through 226 and sealed entries identical', async () => {
    const filenames = ['227_canonical_forecast_capacity_ui_v1.sql',
      '228_canonical_forecast_capacity_ui_v2.sql',
      '229_canonical_forecast_capacity_ui_v3.sql',
      '230_canonical_forecast_capacity_ui_v4.sql',
      '231_canonical_forecast_capacity_ui_v5.sql',
      '232_canonical_forecast_capacity_ui_v6.sql',
      '233_canonical_forecast_capacity_ui_v7.sql'];
    for (const filename of filenames)
      fs.copyFileSync(path.resolve(__dirname, '../../migrations', filename), path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory })).resolves.toBe(true);
    expect(await definitions()).toEqual(originalDefinitions);
    expect((await pool.query(
      `SELECT filename,checksum FROM _migrations WHERE substring(filename,1,3)::integer<=226 ORDER BY filename`)).rows)
      .toEqual(originalChecksums);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE substring(filename,1,3)::integer IN (227,228,229,230,231,232,233) ORDER BY filename`)).rows)
      .toEqual(filenames.map(filename => ({ filename })));
  }, 120000);

  test('startup grants only safe entries and keeps the registry and helpers private', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { migrationRole: 'postgres', runtimeRole })).resolves.toBeUndefined();
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    const row = (await pool.query(`SELECT
      has_table_privilege($1,'canonical_forecast_capacity_ui_action_requests_v1','SELECT') runtime_table,
      has_table_privilege('public','canonical_forecast_capacity_ui_action_requests_v1','SELECT') public_table,
      has_table_privilege($1,'canonical_forecast_capacity_ui_setup_requests_v2','SELECT') runtime_setup_table,
      has_table_privilege('public','canonical_forecast_capacity_ui_setup_requests_v2','SELECT') public_setup_table,
      has_table_privilege($1,'canonical_forecast_capacity_ui_action_requests_v2','SELECT') runtime_action_table,
      has_table_privilege('public','canonical_forecast_capacity_ui_action_requests_v2','SELECT') public_action_table,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v1_current(uuid,uuid,text,uuid)','EXECUTE') runtime_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v1_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,text,text)','EXECUTE') runtime_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v1_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,text,text)','EXECUTE') runtime_decision,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v1_history_item(text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,bigint,text)','EXECUTE') runtime_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v1_current(uuid,uuid,text,uuid)','EXECUTE') public_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v2_current(uuid,uuid,text,uuid)','EXECUTE') runtime_v2_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v2_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text)','EXECUTE') runtime_v2_setup,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v2_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') runtime_v2_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v2_decision_mutate(uuid,uuid,text,uuid,text,text,uuid,uuid,bigint,text,text,text)','EXECUTE') runtime_v2_decision,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v2_setup_plan(uuid)','EXECUTE') runtime_v2_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v2_current_actions(uuid)','EXECUTE') runtime_v2_action_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v2_current(uuid,uuid,text,uuid)','EXECUTE') public_v2_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v3_current(uuid,uuid,text,uuid)','EXECUTE') runtime_v3_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v3_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text)','EXECUTE') runtime_v3_setup,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v3_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') runtime_v3_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v3_setup_plan(uuid)','EXECUTE') runtime_v3_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v3_job_plan(uuid,timestamptz)','EXECUTE') runtime_v3_job_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v3_current(uuid,uuid,text,uuid)','EXECUTE') public_v3_read,
      has_function_privilege('public','canonical_forecast_capacity_ui_v3_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text)','EXECUTE') public_v3_setup,
      has_function_privilege('public','canonical_forecast_capacity_ui_v3_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') public_v3_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v4_current(uuid,uuid,text,uuid)','EXECUTE') runtime_v4_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v4_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') runtime_v4_setup,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v4_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') runtime_v4_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v4_scope_plan(uuid,timestamptz,jsonb)','EXECUTE') runtime_v4_scope_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v4_job_plan(uuid,timestamptz)','EXECUTE') runtime_v4_job_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v4_setup_plan(uuid)','EXECUTE') runtime_v4_setup_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v4_current(uuid,uuid,text,uuid)','EXECUTE') public_v4_read,
      has_function_privilege('public','canonical_forecast_capacity_ui_v4_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') public_v4_setup,
      has_function_privilege('public','canonical_forecast_capacity_ui_v4_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') public_v4_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v5_current(uuid,uuid,text,uuid)','EXECUTE') runtime_v5_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v5_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') runtime_v5_setup,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v5_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') runtime_v5_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v5_scope_plan(uuid,timestamptz,jsonb)','EXECUTE') runtime_v5_scope_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v5_job_plan(uuid,timestamptz)','EXECUTE') runtime_v5_job_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v5_setup_plan(uuid)','EXECUTE') runtime_v5_setup_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v5_current(uuid,uuid,text,uuid)','EXECUTE') public_v5_read,
      has_function_privilege('public','canonical_forecast_capacity_ui_v5_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') public_v5_setup,
      has_function_privilege('public','canonical_forecast_capacity_ui_v5_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') public_v5_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v6_current(uuid,uuid,text,uuid)','EXECUTE') runtime_v6_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v6_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') runtime_v6_setup,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v6_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') runtime_v6_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v6_scope_plan(uuid,timestamptz,jsonb)','EXECUTE') runtime_v6_scope_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v6_job_plan(uuid,timestamptz)','EXECUTE') runtime_v6_job_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v6_setup_plan(uuid)','EXECUTE') runtime_v6_setup_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v6_current(uuid,uuid,text,uuid)','EXECUTE') public_v6_read,
      has_function_privilege('public','canonical_forecast_capacity_ui_v6_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') public_v6_setup,
      has_function_privilege('public','canonical_forecast_capacity_ui_v6_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') public_v6_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v7_current(uuid,uuid,text,uuid)','EXECUTE') runtime_v7_read,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v7_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') runtime_v7_setup,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v7_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') runtime_v7_action,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v7_scope_plan(uuid,timestamptz,jsonb)','EXECUTE') runtime_v7_scope_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v7_job_plan(uuid,timestamptz)','EXECUTE') runtime_v7_job_helper,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v7_setup_plan(uuid)','EXECUTE') runtime_v7_setup_helper,
      has_function_privilege('public','canonical_forecast_capacity_ui_v7_current(uuid,uuid,text,uuid)','EXECUTE') public_v7_read,
      has_function_privilege('public','canonical_forecast_capacity_ui_v7_setup_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,jsonb,text,text)','EXECUTE') public_v7_setup,
      has_function_privilege('public','canonical_forecast_capacity_ui_v7_action_mutate(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,bigint,text,text)','EXECUTE') public_v7_action`,
    [runtimeRole])).rows[0];
    expect(row).toEqual({ runtime_table: false, public_table: false, runtime_read: true,
      runtime_setup_table: false, public_setup_table: false,
      runtime_action_table: false, public_action_table: false,
      runtime_action: true, runtime_decision: true, runtime_helper: false, public_read: false,
      runtime_v2_read: true, runtime_v2_setup: true, runtime_v2_action: true,
      runtime_v2_decision: true, runtime_v2_helper: false, runtime_v2_action_helper: false,
      public_v2_read: false, runtime_v3_read: true, runtime_v3_setup: true,
      runtime_v3_action: true, runtime_v3_helper: false, runtime_v3_job_helper: false,
      public_v3_read: false, public_v3_setup: false, public_v3_action: false,
      runtime_v4_read: true, runtime_v4_setup: true, runtime_v4_action: true,
      runtime_v4_scope_helper: false, runtime_v4_job_helper: false, runtime_v4_setup_helper: false,
      public_v4_read: false, public_v4_setup: false, public_v4_action: false,
      runtime_v5_read: true, runtime_v5_setup: true, runtime_v5_action: true,
      runtime_v5_scope_helper: false, runtime_v5_job_helper: false, runtime_v5_setup_helper: false,
      public_v5_read: false, public_v5_setup: false, public_v5_action: false,
      runtime_v6_read: true, runtime_v6_setup: true, runtime_v6_action: true,
      runtime_v6_scope_helper: false, runtime_v6_job_helper: false, runtime_v6_setup_helper: false,
      public_v6_read: false, public_v6_setup: false, public_v6_action: false,
      runtime_v7_read: true, runtime_v7_setup: true, runtime_v7_action: true,
      runtime_v7_scope_helper: false, runtime_v7_job_helper: false, runtime_v7_setup_helper: false,
      public_v7_read: false, public_v7_setup: false, public_v7_action: false });
    expect((await pool.query(`SELECT count(*)::integer count FROM pg_trigger
      WHERE tgrelid IN ('canonical_forecast_capacity_ui_action_requests_v1'::regclass,
       'canonical_forecast_capacity_ui_setup_requests_v2'::regclass,
       'canonical_forecast_capacity_ui_action_requests_v2'::regclass)
       AND NOT tgisinternal AND tgenabled='O' AND tgtype=58
       AND tgfoid='canonical_forecast_capacity_advisory_v1_immutable()'::regprocedure`)).rows[0].count).toBe(3);
  });

  test('startup fails closed for altered entry, helper and immutability contracts', async () => {
    const fail = async (sql, message) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query(sql);
        await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
          { migrationRole: 'postgres', runtimeRole })).rejects.toThrow(message);
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    };
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v1_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v1_history_item(text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,bigint,text) SECURITY DEFINER`,
      'Required capacity UI v1 helper security is missing');
    await fail(`ALTER TABLE canonical_forecast_capacity_ui_action_requests_v1 DISABLE TRIGGER
      canonical_forecast_capacity_ui_action_requests_v1_immutable`,
    'Required capacity UI v1 action authority is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v2_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v2 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v2_setup_plan(uuid) SET search_path=public`,
      'Required capacity UI v2 private helper security is missing');
    await fail(`ALTER TABLE canonical_forecast_capacity_ui_setup_requests_v2 DISABLE TRIGGER
      canonical_forecast_capacity_ui_setup_requests_v2_immutable`,
    'Required capacity UI v2 setup authority is missing');
    await fail(`ALTER TABLE canonical_forecast_capacity_ui_action_requests_v2 DISABLE TRIGGER
      canonical_forecast_capacity_ui_action_requests_v2_immutable`,
    'Required capacity UI v2 setup authority is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v3_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v3 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v3_job_plan(uuid,timestamptz) SET search_path=public`,
      'Required capacity UI v3 private helper security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v4_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v4 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v4_scope_plan(uuid,timestamptz,jsonb) SET search_path=public`,
      'Required capacity UI v4 private helper security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v5_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v5 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v5_scope_plan(uuid,timestamptz,jsonb) SET search_path=public`,
      'Required capacity UI v5 private helper security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v6_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v6 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v6_scope_plan(uuid,timestamptz,jsonb) SET search_path=public`,
      'Required capacity UI v6 private helper security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v7_current(uuid,uuid,text,uuid) SECURITY INVOKER`,
      'Required capacity UI v7 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_ui_v7_scope_plan(uuid,timestamptz,jsonb) SET search_path=public`,
      'Required capacity UI v7 private helper security is missing');
  }, 120000);

  test('a fresh database reaches the same migration233 authority', async () => {
    const fresh = await createSuiteDatabase('m26-p5d-fresh'); const freshPool = new Pool({ connectionString: fresh.connectionString, max: 1 });
    try {
      await expect(db.runMigrations({ pool: freshPool })).resolves.toBe(true);
      expect((await freshPool.query(`SELECT to_regprocedure(
        'canonical_forecast_capacity_ui_v7_current(uuid,uuid,text,uuid)') IS NOT NULL present`)).rows[0].present).toBe(true);
    } finally { await freshPool.end(); await fresh.cleanup(); }
  }, 120000);
});
