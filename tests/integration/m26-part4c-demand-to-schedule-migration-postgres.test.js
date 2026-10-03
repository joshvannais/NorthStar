'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 4C migration 221 to demand-to-schedule v1', () => {
  let database; let pool; let migrationDirectory;
  const db = require('../../src/db');

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p4c-demand-schedule-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p4c-pre222-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 221)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
    await pool.query('CREATE ROLE northstar_p4c_runtime NOLOGIN');
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
    try { await admin.query('DROP ROLE IF EXISTS northstar_p4c_runtime'); }
    finally { await admin.end(); }
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p4c-pre222-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('adds migration222 without changing accepted backlog, Retell or Part4B entries', async () => {
    const signature = async () => (await pool.query(`SELECT
      pg_get_functiondef('canonical_forecast_current_backlog_snapshot_read_v2(uuid,uuid,text,uuid,uuid)'::regprocedure) backlog,
      pg_get_functiondef('canonical_forecast_retell_future_origin_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) retell,
      pg_get_functiondef('canonical_forecast_transition_origin_v2_read(uuid,uuid,text,uuid,uuid)'::regprocedure) transition`)).rows[0];
    const before = await signature();
    const source = path.resolve(__dirname, '../../migrations');
    const filename = '222_canonical_forecast_demand_to_schedule_v1.sql';
    fs.copyFileSync(path.join(source, filename), path.join(migrationDirectory, filename));
    await expect(db.runMigrations({ pool, migrationsDirectory: migrationDirectory }))
      .resolves.toBe(true);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { migrationRole: 'postgres', runtimeRole: 'northstar_p4c_runtime' }))
        .resolves.toBeUndefined();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
    expect(await signature()).toEqual(before);
    expect((await pool.query(`SELECT filename FROM _migrations
      WHERE filename LIKE '221_%' OR filename LIKE '222_%' ORDER BY filename`))
      .rows.map(row => row.filename)).toEqual([
      '221_canonical_forecast_transition_future_origins_v2.sql', filename,
    ]);
  }, 120000);

  test('keeps all storage and helpers private while granting only guarded entries', async () => {
    const result = (await pool.query(`SELECT
      to_regclass('canonical_forecast_demand_schedule_epochs_v1')::text epochs,
      to_regclass('canonical_forecast_demand_schedule_backlog_facts_v1')::text backlog,
      to_regclass('canonical_forecast_seasonal_origins_v1')::text seasonal_origins,
      to_regclass('canonical_forecast_pipeline_origins_v1')::text pipeline_origins,
      has_table_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_origins_v1','SELECT') runtime_table,
      has_function_privilege('public','canonical_forecast_pipeline_origin_v1_capture(uuid,uuid,text,uuid,text,text)','EXECUTE') public_capture,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_pipeline_origin_v1_capture(uuid,uuid,text,uuid,text,text)','EXECUTE') runtime_capture,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_origin_v1_read(uuid,uuid,text,uuid,uuid)','EXECUTE') runtime_read,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_demand_schedule_clock_v1()','EXECUTE') runtime_clock,
      has_table_privilege('northstar_p4c_runtime','canonical_forecast_demand_schedule_source_test_clock_v1','SELECT') runtime_source_clock_table,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_demand_schedule_source_test_clock_v1_set(timestamptz)','EXECUTE') runtime_source_clock_setter,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_demand_schedule_source_clock_v1_apply()','EXECUTE') runtime_source_clock,
      has_table_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_call_visibility_v1','SELECT') runtime_seasonal_call_table,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_call_visibility_v1_capture()','EXECUTE') runtime_seasonal_call_capture,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_call_generation_v1(uuid,timestamptz,timestamptz)','EXECUTE') runtime_seasonal_call_generation,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_signal_v1(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)','EXECUTE') runtime_signal,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_seasonal_input_current_v1(uuid,uuid,text,uuid,canonical_forecast_seasonal_origins_v1)','EXECUTE') runtime_seasonal_helper,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_demand_schedule_epoch_current_v1(uuid,canonical_forecast_demand_schedule_epochs_v1)','EXECUTE') runtime_epoch_helper,
      has_function_privilege('northstar_p4c_runtime','canonical_forecast_pipeline_outcome_v1(uuid,canonical_forecast_pipeline_origins_v1)','EXECUTE') runtime_pipeline_helper`)).rows[0];
    expect(result).toEqual({ epochs: 'canonical_forecast_demand_schedule_epochs_v1',
      backlog: 'canonical_forecast_demand_schedule_backlog_facts_v1',
      seasonal_origins: 'canonical_forecast_seasonal_origins_v1',
      pipeline_origins: 'canonical_forecast_pipeline_origins_v1',
      runtime_table: false, public_capture: false, runtime_capture: true,
      runtime_read: true, runtime_clock: false, runtime_signal: false,
      runtime_source_clock_table: false, runtime_source_clock_setter: false,
      runtime_source_clock: false, runtime_seasonal_helper: false,
      runtime_seasonal_call_table: false, runtime_seasonal_call_capture: false,
      runtime_seasonal_call_generation: false,
      runtime_epoch_helper: false,
      runtime_pipeline_helper: false });
    expect((await pool.query(`SELECT count(*)::integer count FROM pg_trigger
      WHERE NOT tgisinternal AND tgenabled='O' AND tgtype=58 AND tgrelid IN (
       'canonical_forecast_demand_schedule_epochs_v1'::regclass,
       'canonical_forecast_demand_schedule_methods_v1'::regclass,
       'canonical_forecast_demand_schedule_method_reviews_v1'::regclass,
       'canonical_forecast_demand_schedule_backlog_facts_v1'::regclass,
       'canonical_forecast_seasonal_origins_v1'::regclass,
       'canonical_forecast_seasonal_evaluations_v1'::regclass,
       'canonical_forecast_pipeline_origins_v1'::regclass,
       'canonical_forecast_pipeline_evaluations_v1'::regclass,
       'canonical_forecast_pipeline_eligibility_visibility_v1'::regclass,
       'canonical_forecast_pipeline_booking_visibility_v1'::regclass,
       'canonical_forecast_seasonal_certification_visibility_v1'::regclass,
       'canonical_forecast_seasonal_call_visibility_v1'::regclass)`)).rows[0].count).toBe(12);
  }, 120000);

  test('hashes the full parent key before deriving bounded child keys', async () => {
    const first = 'x'.repeat(80) + 'a'.repeat(48);
    const second = 'x'.repeat(80) + 'b'.repeat(48);
    const result = (await pool.query(`SELECT
      canonical_forecast_demand_schedule_child_key_v1($1,'backlog') AS first_key,
      canonical_forecast_demand_schedule_child_key_v1($2,'backlog') AS second_key`,
    [first, second])).rows[0];
    expect(result.first_key).toHaveLength(71);
    expect(result.second_key).toHaveLength(71);
    expect(result.first_key).not.toBe(result.second_key);
  }, 120000);

  test('computes only repeated two-cycle seasonal directions and distinguishes complete zero', async () => {
    const signal = async values => (await pool.query(
      `SELECT canonical_forecast_seasonal_signal_v1(
       $1,$2,$3,$4,$5,$6,$7,$8,$9) value`, values)).rows[0].value;
    await expect(signal([0, 1200, 0, 1200, 0, 100, 0, 100, 100]))
      .resolves.toMatchObject({ direction: 'authenticated_complete_zero_no_signal',
        point: null, empiricallyCalibrated: false, statisticalSignificanceAvailable: false });
    await expect(signal([12, 1200, 24, 1200, 1, 100, 2, 100, 100]))
      .resolves.toMatchObject({ direction: 'repeated_neutral', point: 1.5 });
    await expect(signal([12, 1200, 24, 1200, 2, 100, 3, 100, 100]))
      .resolves.toMatchObject({ direction: 'repeated_high', point: 2.5 });
    await expect(signal([24, 1200, 36, 1200, 1, 100, 2, 100, 100]))
      .resolves.toMatchObject({ direction: 'repeated_low', point: 1.5 });
    await expect(signal([12, 1200, 24, 1200, 2, 100, 1, 100, 100]))
      .resolves.toMatchObject({ direction: 'inconclusive', point: null });
    await expect(signal([12, 0, 24, 1200, 2, 100, 3, 100, 100]))
      .rejects.toMatchObject({ code: '22023' });
  }, 120000);

  test('runtime startup verification fails closed when an entry authority is missing', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`ALTER FUNCTION
        canonical_forecast_pipeline_evaluation_v1_read(uuid,uuid,text,uuid,uuid)
        RENAME TO canonical_forecast_pipeline_evaluation_v1_read_missing`);
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
        { migrationRole: 'postgres', runtimeRole: 'northstar_p4c_runtime' }))
        .rejects.toThrow('Required demand-to-schedule v1 authority is missing');
    } finally {
      await client.query('ROLLBACK').catch(() => {}); client.release();
    }
  }, 120000);

  test('runtime startup fails closed for missing, disabled or misdirected prospective triggers',
    async () => {
      const failure = async (sql, message) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await expect(db.grantAndVerifyRuntimeAuthorityForTests(client,
            { migrationRole: 'postgres', runtimeRole: 'northstar_p4c_runtime' }))
            .rejects.toThrow(message);
        } finally {
          await client.query('ROLLBACK').catch(() => {}); client.release();
        }
      };
      await failure(`DROP TRIGGER z_canonical_forecast_pipeline_eligibility_visibility_v1_capture
        ON canonical_forecast_opportunity_eligibility_events`,
      'Required demand-to-schedule v1 prospective capture is missing');
      await failure(`ALTER TABLE canonical_forecast_schedule_booking_events DISABLE TRIGGER
        z_canonical_forecast_pipeline_booking_visibility_v1_capture`,
      'Required demand-to-schedule v1 prospective capture is missing');
      await failure(`DROP TRIGGER z_canonical_forecast_seasonal_certification_visibility_v1_capture
          ON canonical_forecast_retell_period_certifications_v2;
        CREATE TRIGGER z_canonical_forecast_seasonal_certification_visibility_v1_capture
          AFTER INSERT ON canonical_forecast_retell_period_certifications_v2
          FOR EACH ROW EXECUTE FUNCTION canonical_forecast_transition_v2_immutable()`,
      'Required demand-to-schedule v1 prospective capture is missing');
      await failure(`DROP TRIGGER z_canonical_forecast_seasonal_call_visibility_v1_capture
        ON canonical_operations`,
      'Required demand-to-schedule v1 prospective capture is missing');
      await failure(`ALTER TABLE canonical_operations DISABLE TRIGGER
        z_canonical_forecast_seasonal_call_visibility_v1_capture`,
      'Required demand-to-schedule v1 prospective capture is missing');
      await failure(`DROP TRIGGER z_canonical_forecast_seasonal_call_visibility_v1_capture
          ON canonical_operations;
        CREATE TRIGGER z_canonical_forecast_seasonal_call_visibility_v1_capture
          AFTER UPDATE OF state ON canonical_operations
          FOR EACH ROW EXECUTE FUNCTION canonical_forecast_transition_v2_immutable()`,
      'Required demand-to-schedule v1 prospective capture is missing');
      await failure(`ALTER TABLE canonical_forecast_pipeline_booking_visibility_v1
        DISABLE TRIGGER canonical_forecast_pipeline_booking_visibility_v1_immutable`,
      'Required demand-to-schedule v1 immutability is missing');
      await failure(`ALTER TABLE canonical_forecast_demand_schedule_method_reviews_v1
        DISABLE TRIGGER canonical_forecast_demand_schedule_method_reviews_v1_immutable`,
      'Required demand-to-schedule v1 immutability is missing');
      await failure(`DROP TRIGGER canonical_forecast_seasonal_evaluations_v1_immutable
          ON canonical_forecast_seasonal_evaluations_v1;
        CREATE TRIGGER canonical_forecast_seasonal_evaluations_v1_immutable
          BEFORE UPDATE OR DELETE OR TRUNCATE ON canonical_forecast_seasonal_evaluations_v1
          FOR EACH STATEMENT EXECUTE FUNCTION canonical_forecast_schedule_booking_event_immutable()`,
      'Required demand-to-schedule v1 immutability is missing');
    }, 120000);
});
