'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 2B migration 211 rolling-upgrade boundary', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p2b-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p2b-pre212-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 211)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p2b-pre212-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  async function inheritedIdentity() {
    return (await pool.query(`
      SELECT
       pg_get_functiondef('canonical_forecast_estimate_decision_snapshot_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) v1_capture,
       pg_get_functiondef('canonical_forecast_source_snapshot_read(uuid,uuid,text,uuid,uuid)'::regprocedure) v1_read,
       pg_get_functiondef('canonical_forecast_profile_effective_anchor_pin(uuid,uuid,text,uuid,uuid)'::regprocedure) profile_pin,
       pg_get_functiondef('canonical_forecast_profile_effective_window(uuid,uuid,text,uuid,uuid,timestamptz,timestamptz)'::regprocedure) profile_window,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) v2_capture,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) v2_read,
       pg_get_functiondef('canonical_forecast_approved_estimate_v2_gap(uuid,timestamptz)'::regprocedure) v2_gap,
       (SELECT jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,
          'nullable',is_nullable,'default',column_default) ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='canonical_forecast_approved_estimate_v2_snapshots') v2_columns,
       (SELECT jsonb_agg(tgname ORDER BY tgname)
        FROM pg_trigger
        WHERE tgrelid='canonical_forecast_approved_estimate_v2_snapshots'::regclass
          AND NOT tgisinternal) v2_triggers`)).rows[0];
  }

  test('adds only the distinct v2 comparable-month authority and leaves older paths unchanged',
    async () => {
      const before = await inheritedIdentity();
      const source = path.resolve(__dirname, '../../migrations');
      fs.copyFileSync(
        path.join(source, '212_canonical_forecast_comparable_months_v2.sql'),
        path.join(migrationDirectory, '212_canonical_forecast_comparable_months_v2.sql'));
      expect(await db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
        .toBe(true);
      expect(await inheritedIdentity()).toEqual(before);
      expect((await pool.query(
        `SELECT filename FROM _migrations WHERE filename LIKE '21%_canonical%'
         ORDER BY filename`)).rows.map(row => row.filename)).toEqual([
        '210_canonical_forecast_current_backlog_composition_marker.sql',
        '211_canonical_forecast_approved_estimate_asof_v2.sql',
        '212_canonical_forecast_comparable_months_v2.sql',
      ]);
      expect((await pool.query(
        `SELECT to_regclass('canonical_forecast_comparable_month_v2_receipts')::text relation`))
        .rows[0].relation).toBe('canonical_forecast_comparable_month_v2_receipts');
    }, 120000);
});
