'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 3C migrations 214 through 216 rolling upgrade', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p3c-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(),
      'northstar-m26-p3c-pre215-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 214)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p3c-pre215-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('adds only the receipt-bound read authority and preserves older contracts',
    async () => {
      const before = (await pool.query(`SELECT
       pg_get_functiondef('canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)'::regprocedure) complete_window,
       pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) capture,
       pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) read,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_lineage_replay(uuid,uuid,text,uuid,jsonb)'::regprocedure) lineage`)).rows[0];
      const source = path.resolve(__dirname, '../../migrations');
      const filename = '215_canonical_forecast_complete_window_measurement_v2.sql';
      fs.copyFileSync(path.join(source, filename),
        path.join(migrationDirectory, filename));
      expect(await db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
        .toBe(true);
      expect((await pool.query(`SELECT
       pg_get_functiondef('canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)'::regprocedure) complete_window,
       pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) capture,
       pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) read,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_lineage_replay(uuid,uuid,text,uuid,jsonb)'::regprocedure) lineage`)).rows[0]).toEqual(before);
      expect((await pool.query(`SELECT filename FROM _migrations
        WHERE filename LIKE '21%_canonical%' ORDER BY filename`)).rows
        .map(row => row.filename)).toEqual([
        '210_canonical_forecast_current_backlog_composition_marker.sql',
        '211_canonical_forecast_approved_estimate_asof_v2.sql',
        '212_canonical_forecast_comparable_months_v2.sql',
        '213_canonical_forecast_approved_estimate_lineage_replay_v2.sql',
        '214_canonical_forecast_complete_window_evaluation_v2.sql',
        filename,
      ]);
      expect((await pool.query(`SELECT
       to_regprocedure('canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)')::text measurement,
       has_function_privilege('public',
        'canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)',
        'EXECUTE') public_execute`)).rows[0]).toEqual({
        measurement:
          'canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)',
        public_execute: false,
      });
    }, 120000);

  test('replaces only the measurement authority to gate drift actions', async () => {
    const before = (await pool.query(`SELECT
     pg_get_functiondef('canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)'::regprocedure) measurement,
     pg_get_functiondef('canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)'::regprocedure) complete_window,
     pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) capture,
     pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) read`)).rows[0];
    const source = path.resolve(__dirname, '../../migrations');
    const filename =
      '216_canonical_forecast_complete_window_measurement_drift_gate.sql';
    fs.copyFileSync(path.join(source, filename),
      path.join(migrationDirectory, filename));
    expect(await db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
      .toBe(true);
    const after = (await pool.query(`SELECT
     pg_get_functiondef('canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)'::regprocedure) measurement,
     pg_get_functiondef('canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)'::regprocedure) complete_window,
     pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) capture,
     pg_get_functiondef('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) read`)).rows[0];
    expect(after.measurement).not.toEqual(before.measurement);
    expect(after.measurement).toContain(
      'sample_reason IS NULL AND reference_count=30 AND later_count=30');
    expect(after.complete_window).toEqual(before.complete_window);
    expect(after.capture).toEqual(before.capture);
    expect(after.read).toEqual(before.read);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE filename LIKE '21%_canonical%' ORDER BY filename`)).rows
      .map(row => row.filename)).toEqual([
      '210_canonical_forecast_current_backlog_composition_marker.sql',
      '211_canonical_forecast_approved_estimate_asof_v2.sql',
      '212_canonical_forecast_comparable_months_v2.sql',
      '213_canonical_forecast_approved_estimate_lineage_replay_v2.sql',
      '214_canonical_forecast_complete_window_evaluation_v2.sql',
      '215_canonical_forecast_complete_window_measurement_v2.sql',
      filename,
    ]);
    expect((await pool.query(`SELECT has_function_privilege('public',
      'canonical_forecast_complete_window_measurement_v2(uuid,uuid,text,uuid,uuid)',
      'EXECUTE') public_execute`)).rows[0]).toEqual({ public_execute: false });
  }, 120000);
});
