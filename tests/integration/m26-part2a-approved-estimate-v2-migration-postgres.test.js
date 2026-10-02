'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 2A migration 210 rolling-upgrade boundary', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p2a-v2-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p2a-pre211-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 210)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p2a-pre211-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  async function legacyIdentity() {
    return (await pool.query(`
      SELECT
       pg_get_functiondef('canonical_forecast_estimate_decision_snapshot_capture(uuid,uuid,text,uuid,text,text)'::regprocedure) capture,
       pg_get_functiondef('canonical_forecast_source_snapshot_read(uuid,uuid,text,uuid,uuid)'::regprocedure) read,
       pg_get_functiondef('canonical_forecast_estimate_decision_pins(uuid,timestamptz)'::regprocedure) pins,
       (SELECT jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,
          'nullable',is_nullable,'default',column_default) ORDER BY ordinal_position)
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='canonical_forecast_source_snapshots') columns,
       (SELECT jsonb_agg(tgname ORDER BY tgname)
        FROM pg_trigger WHERE tgrelid='canonical_forecast_source_snapshots'::regclass
         AND NOT tgisinternal) triggers`)).rows[0];
  }

  test('drains the migration210 writer lane and leaves every v1 definition unchanged', async () => {
    const before = await legacyIdentity();
    const source = path.resolve(__dirname, '../../migrations');
    fs.copyFileSync(
      path.join(source, '211_canonical_forecast_approved_estimate_asof_v2.sql'),
      path.join(migrationDirectory, '211_canonical_forecast_approved_estimate_asof_v2.sql'));
    const blocker = await pool.connect();
    let applying;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE canonical_estimate_decisions IN ROW EXCLUSIVE MODE');
      applying = db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
      const deadline = Date.now() + 4000;
      let waiters = 0;
      while (Date.now() < deadline) {
        waiters = (await pool.query(
          `SELECT count(*)::integer count FROM pg_locks
           WHERE locktype='relation' AND NOT granted
            AND relation='canonical_estimate_decisions'::regclass`)).rows[0].count;
        if (waiters > 0) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiters).toBeGreaterThan(0);
      expect((await pool.query(
        `SELECT to_regclass('canonical_forecast_approved_estimate_v2_epochs') relation`))
        .rows[0].relation).toBeNull();
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
    expect(await applying).toBe(true);
    expect(await legacyIdentity()).toEqual(before);
    const state = (await pool.query(
      `SELECT filename FROM _migrations WHERE filename LIKE '21%_canonical%'
       ORDER BY filename`)).rows.map(row => row.filename);
    expect(state).toEqual([
      '210_canonical_forecast_current_backlog_composition_marker.sql',
      '211_canonical_forecast_approved_estimate_asof_v2.sql',
    ]);
    expect((await pool.query(
      `SELECT to_regclass('canonical_forecast_approved_estimate_v2_snapshots')::text relation`))
      .rows[0].relation).toBe('canonical_forecast_approved_estimate_v2_snapshots');
  }, 120000);
});
