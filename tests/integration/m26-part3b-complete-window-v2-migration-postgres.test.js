'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 3B migration 213 to 214 rolling upgrade', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p3b-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(),
      'northstar-m26-p3b-pre214-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 213)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p3b-pre214-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('adds only the purpose-fixed receipt authority and preserves older contracts',
    async () => {
      const before = (await pool.query(`SELECT
       pg_get_functiondef('canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)'::regprocedure) complete_window,
       pg_get_functiondef('canonical_forecast_capture_price_flow_evaluation(uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb)'::regprocedure) selected_pair,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_lineage_replay(uuid,uuid,text,uuid,jsonb)'::regprocedure) lineage`)).rows[0];
      const source = path.resolve(__dirname, '../../migrations');
      fs.copyFileSync(path.join(source,
        '214_canonical_forecast_complete_window_evaluation_v2.sql'),
      path.join(migrationDirectory,
        '214_canonical_forecast_complete_window_evaluation_v2.sql'));
      expect(await db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
        .toBe(true);
      expect((await pool.query(`SELECT
       pg_get_functiondef('canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)'::regprocedure) complete_window,
       pg_get_functiondef('canonical_forecast_capture_price_flow_evaluation(uuid,uuid,text,uuid,text,text,uuid,uuid,jsonb)'::regprocedure) selected_pair,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_lineage_replay(uuid,uuid,text,uuid,jsonb)'::regprocedure) lineage`)).rows[0]).toEqual(before);
      expect((await pool.query(`SELECT filename FROM _migrations
        WHERE filename LIKE '21%_canonical%' ORDER BY filename`)).rows
        .map(row => row.filename)).toEqual([
        '210_canonical_forecast_current_backlog_composition_marker.sql',
        '211_canonical_forecast_approved_estimate_asof_v2.sql',
        '212_canonical_forecast_comparable_months_v2.sql',
        '213_canonical_forecast_approved_estimate_lineage_replay_v2.sql',
        '214_canonical_forecast_complete_window_evaluation_v2.sql',
      ]);
      expect((await pool.query(`SELECT
       to_regclass('canonical_forecast_complete_window_evaluations_v2')::text relation,
       to_regprocedure('canonical_forecast_price_flow_origin_inventory_fence_v2()')::text inventory_fence,
       to_regprocedure('canonical_forecast_complete_window_evaluation_v2_capture(uuid,uuid,text,uuid,text,text)')::text capture,
       to_regprocedure('canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)')::text read,
       EXISTS(SELECT 1 FROM pg_trigger
        WHERE tgrelid='canonical_forecast_price_flow_saved_origins'::regclass
         AND tgname='canonical_forecast_price_flow_origin_inventory_fence_v2'
         AND tgenabled='O' AND tgtype=7 AND NOT tgisinternal) inventory_trigger`)).rows[0])
        .toEqual({ relation: 'canonical_forecast_complete_window_evaluations_v2',
          inventory_fence: 'canonical_forecast_price_flow_origin_inventory_fence_v2()',
          capture: 'canonical_forecast_complete_window_evaluation_v2_capture(uuid,uuid,text,uuid,text,text)',
          read: 'canonical_forecast_complete_window_evaluation_v2_read(uuid,uuid,text,uuid,uuid)',
          inventory_trigger: true });
    }, 120000);
});
