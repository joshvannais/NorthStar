'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 4D migration222 to prerequisite projection', () => {
  let database; let pool; let migrationDirectory;
  const db = require('../../src/db');
  const runtimeRole = 'northstar_p4d_runtime';

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p4d-prerequisite-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 3 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p4d-pre223-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 222)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query(`CREATE ROLE ${runtimeRole} NOLOGIN`);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`); }
    finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p4d-pre223-')) {
      fs.rmSync(migrationDirectory, { recursive: true, force: true });
    }
  }, 120000);

  test('adds only the read entry and preserves accepted Part4C authorities', async () => {
    const signature = async () => (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_seasonal_origin_v1_capture(uuid,uuid,text,uuid,text,text,date)'::regprocedure) seasonal,
      pg_get_functiondef('canonical_forecast_pipeline_origin_v1_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) pipeline,
      pg_get_functiondef('canonical_forecast_demand_schedule_method_review_v1_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,text,text,text)'::regprocedure) review`)).rows[0];
    const before = await signature();
    const filename = '223_canonical_forecast_demand_ui_prerequisites_v1.sql';
    fs.copyFileSync(path.resolve(__dirname, '../../migrations', filename),
      path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
      .resolves.toBe(true);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { migrationRole: 'postgres', runtimeRole })).resolves.toBeUndefined();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }

    expect(await signature()).toEqual(before);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE filename LIKE '222_%' OR filename LIKE '223_%' ORDER BY filename`))
      .rows.map(row => row.filename)).toEqual([
      '222_canonical_forecast_demand_to_schedule_v1.sql', filename,
    ]);
    const authority = (await pool.query(`SELECT routine.prosecdef,
      routine.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[] safe_path,
      has_function_privilege('public',routine.oid,'EXECUTE') public_execute,
      has_function_privilege($1,routine.oid,'EXECUTE') runtime_execute
      FROM pg_proc routine WHERE routine.oid=
       'canonical_forecast_demand_ui_prerequisites_v1_read(uuid,uuid,text,uuid)'::regprocedure`,
    [runtimeRole])).rows[0];
    expect(authority).toEqual({ prosecdef: true, safe_path: true,
      public_execute: false, runtime_execute: true });
  }, 120000);
});
