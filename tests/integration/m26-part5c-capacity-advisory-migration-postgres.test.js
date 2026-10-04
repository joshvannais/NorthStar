'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 5C migration225 to capacity-advisory v1', () => {
  let database; let pool; let migrationDirectory;
  const db = require('../../src/db');
  const runtimeRole = 'northstar_p5c_runtime';

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p5c-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 1 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p5c-pre226-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 225))
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
    await pool.query(`SET northstar.runtime_role='${runtimeRole}'`);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`); } finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p5c-pre226-'))
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
  }, 120000);

  test('adds only migration226 and leaves accepted Part5A and Part5B entries byte-identical', async () => {
    const signature = async () => (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_workload_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)'::regprocedure) workload,
      pg_get_functiondef('canonical_forecast_constrained_capacity_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)'::regprocedure) constrained`)).rows[0];
    const before = await signature();
    const filename = '226_canonical_forecast_capacity_advisory_v1.sql';
    fs.copyFileSync(path.resolve(__dirname, '../../migrations', filename), path.join(migrationDirectory, filename));
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
      WHERE filename LIKE '225_%' OR filename LIKE '226_%' ORDER BY filename`))
      .rows.map(row => row.filename)).toEqual([
      '225_canonical_forecast_constrained_capacity_v1.sql', filename,
    ]);
    expect((await pool.query(`SELECT pg_get_indexdef(indexrelid) definition
      FROM pg_index WHERE indexrelid='canonical_forecast_capacity_advisory_origin_generation_v1'::regclass`))
      .rows[0].definition).toContain('generation');
  }, 120000);

  test('grants only guarded entries and keeps tables and helpers private', async () => {
    const row = (await pool.query(`SELECT
      has_table_privilege($1,'canonical_forecast_capacity_advisory_origins_v1','SELECT') runtime_table,
      has_table_privilege('public','canonical_forecast_capacity_advisory_origins_v1','SELECT') public_table,
      has_function_privilege($1,'canonical_forecast_capacity_advisory_v1_origin_capture_v2(uuid,uuid,text,uuid,text,text,text,text,uuid)','EXECUTE') runtime_entry,
      has_function_privilege('public','canonical_forecast_capacity_advisory_v1_origin_capture(uuid,uuid,text,uuid,text,text,text,text)','EXECUTE') public_entry,
      has_function_privilege($1,'canonical_forecast_capacity_advisory_v1_lock_sources(uuid)','EXECUTE') runtime_helper,
      has_function_privilege($1,'canonical_forecast_capacity_advisory_v1_constraint_manifest_current(uuid,jsonb,timestamptz,timestamptz)','EXECUTE') runtime_manifest_helper`,
    [runtimeRole])).rows[0];
    expect(row).toEqual({ runtime_table: false, public_table: false, runtime_entry: true,
      public_entry: false, runtime_helper: false, runtime_manifest_helper: false });
    expect((await pool.query(`SELECT count(*)::integer count FROM pg_trigger
      WHERE NOT tgisinternal AND tgenabled='O' AND tgtype=58
       AND tgfoid='canonical_forecast_capacity_advisory_v1_immutable()'::regprocedure`))
      .rows[0].count).toBe(9);
  });

  test('startup fails closed for missing entry, altered helper security and disabled immutability', async () => {
    const fail = async (sql, message) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await client.query(sql);
        await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
          { migrationRole: 'postgres', runtimeRole })).rejects.toThrow(message);
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    };
    await fail(`ALTER FUNCTION canonical_forecast_capacity_advisory_v1_origin_read(uuid,uuid,text,uuid,uuid)
      RENAME TO canonical_forecast_capacity_advisory_v1_origin_read_missing`,
    'Required capacity-advisory v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_advisory_v1_lock_sources(uuid) SECURITY INVOKER`,
      'Required capacity-advisory v1 entry security is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_advisory_v1_constraint_manifest_current(uuid,jsonb,timestamptz,timestamptz)
      SET search_path TO public`, 'Required capacity-advisory v1 entry security is missing');
    await fail(`ALTER TABLE canonical_forecast_capacity_advisory_evaluations_v1 DISABLE TRIGGER
      canonical_forecast_capacity_advisory_evaluations_v1_immutable`,
    'Required capacity-advisory v1 immutability is missing');
    await fail(`ALTER FUNCTION canonical_forecast_capacity_advisory_v1_continuation_activate(uuid,uuid) SECURITY INVOKER`,
      'Required capacity-advisory v1 entry security is missing');
    await fail(`ALTER TABLE canonical_forecast_capacity_advisory_continuations_v1 DISABLE TRIGGER
      canonical_forecast_capacity_advisory_continuations_v1_immutable`,
    'Required capacity-advisory v1 immutability is missing');
  }, 120000);
});
