'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const db = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migration = '235_canonical_forecast_pipeline_scenarios.sql';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function copyMigrations(maximum) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-p6b-'));
  const source = path.resolve(__dirname, '../../migrations');
  for (const name of fs.readdirSync(source)
    .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= maximum)) {
    fs.copyFileSync(path.join(source, name), path.join(directory, name));
  }
  return directory;
}

realPostgres('Mission 26 Part 6B migration 234 to 235 rolling upgrade', () => {
  let database;
  let pool;
  let directory;

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p6b-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 8 });
    directory = copyMigrations(234);
    await db.runMigrations({ pool, migrationsDirectory: directory });
    await pool.query(`
      INSERT INTO organizations(id,name,email,timezone)
      VALUES('10000000-0000-4000-8000-000000000001','Part 6B Upgrade',
       'part6b-upgrade@example.test','UTC');
      INSERT INTO canonical_operations(id,organization_id,graph_id,
       idempotency_key_hash,payload_fingerprint,state,lease_owner,lease_expires_at)
      VALUES('10000000-0000-4000-8000-000000000002',
       '10000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000003',repeat('1',64),repeat('2',64),
       'claimed','10000000-0000-4000-8000-000000000004',clock_timestamp()+interval '1 hour');
      INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
      VALUES('10000000-0000-4000-8000-000000000005',
       '10000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000002',
       '10000000-0000-4000-8000-000000000003','Part 6B customer');
      INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
       customer_id,status,job_scope)
      VALUES('10000000-0000-4000-8000-000000000006',
       '10000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000002',
       '10000000-0000-4000-8000-000000000003',
       '10000000-0000-4000-8000-000000000005','open','{}'::jsonb)`);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (directory && path.dirname(directory) === os.tmpdir() &&
        path.basename(directory).startsWith('northstar-m26-p6b-')) {
      fs.rmSync(directory, { recursive: true });
    }
  }, 120000);

  test('bounds lock contention, rolls back all DDL, retries, and fences an old writer',
    async () => {
      expect(db.reviewedMigrationTimeoutValues(migration,
        { lock_timeout: '0', statement_timeout: '0' }))
        .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
      expect(db.reviewedMigrationTimeoutValues(migration,
        { lock_timeout: '200', statement_timeout: '1000' }))
        .toEqual({ lockTimeout: '200ms', statementTimeout: '1000ms' });
      const before = (await pool.query(`SELECT
        pg_get_functiondef('canonical_forecast_integrated_commercial_closure_digest()'::regprocedure) closure,
        pg_get_functiondef('canonical_forecast_pipeline_risk_v1(uuid,timestamptz,timestamptz)'::regprocedure) risk`)).rows[0];
      fs.copyFileSync(path.resolve(__dirname, '../../migrations', migration),
        path.join(directory, migration));
      const holder = await pool.connect();
      const oldWriter = await pool.connect();
      const bounded = new Pool({ connectionString: database.connectionString,
        options: '-c lock_timeout=200ms -c statement_timeout=1000ms', max: 1 });
      try {
        await oldWriter.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await holder.query('BEGIN');
        await holder.query('LOCK TABLE canonical_estimates IN ROW EXCLUSIVE MODE');
        await expect(db.runMigrations({ pool: bounded, migrationsDirectory: directory }))
          .rejects.toThrow(/lock timeout/);
        expect((await pool.query(`SELECT count(*)::int count FROM _migrations
          WHERE filename=$1`, [migration])).rows[0].count).toBe(0);
        expect((await pool.query(`SELECT
          to_regclass('canonical_forecast_pipeline_scenario_origins') relation,
          to_regprocedure('canonical_forecast_pipeline_scenario_clock()') routine`))
          .rows[0]).toEqual({ relation: null, routine: null });
        await holder.query('COMMIT');
        await expect(db.runMigrations({ pool: bounded, migrationsDirectory: directory }))
          .resolves.toBe(true);

        await oldWriter.query(`INSERT INTO canonical_estimates(id,organization_id,
          operation_id,graph_id,opportunity_id,calculation_version,
          normalized_input_fingerprint,business_profile_version,business_profile_hash,
          currency,customer_price,line_items,calculation_output,snapshot_digest)
          VALUES('10000000-0000-4000-8000-000000000007',
           '10000000-0000-4000-8000-000000000001',
           '10000000-0000-4000-8000-000000000002',
           '10000000-0000-4000-8000-000000000003',
           '10000000-0000-4000-8000-000000000006','part6b-upgrade-v1',
           repeat('3',64),'profile-v1',repeat('4',64),'USD',100.00,
           '[]'::jsonb,'{}'::jsonb,repeat('5',64))`);
        await oldWriter.query('COMMIT');
      } finally {
        await oldWriter.query('ROLLBACK').catch(() => {});
        oldWriter.release();
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
        await bounded.end();
      }
      expect((await pool.query(`SELECT source_kind FROM
        canonical_forecast_pipeline_estimate_sources WHERE organization_id=$1 AND
        estimate_id='10000000-0000-4000-8000-000000000007'`,
      ['10000000-0000-4000-8000-000000000001'])).rows)
        .toEqual([{ source_kind: 'post_install_insert' }]);
      expect((await pool.query(`SELECT
        pg_get_functiondef('canonical_forecast_integrated_commercial_closure_digest()'::regprocedure) closure,
        pg_get_functiondef('canonical_forecast_pipeline_risk_v1(uuid,timestamptz,timestamptz)'::regprocedure) risk`)).rows[0])
        .toEqual(before);
    }, 120000);

  test('installs the exact immutable topology, closure, ACL, and guarded test seam',
    async () => {
      const topology = (await pool.query(`SELECT
        (SELECT count(*)::int FROM pg_trigger trigger_value WHERE
          NOT trigger_value.tgisinternal AND trigger_value.tgname IN (
           'canonical_forecast_pipeline_estimate_sources_immutable',
           'canonical_forecast_pipeline_estimate_update_guard',
           'canonical_forecast_pipeline_estimate_source_insert',
           'canonical_forecast_pipeline_scenario_method_immutable',
           'canonical_forecast_pipeline_scenario_policy_immutable',
           'canonical_forecast_pipeline_scenario_origins_immutable',
           'canonical_forecast_pipeline_scenario_evaluations_immutable')) local_triggers,
        (SELECT rtrim(dependency_closure_digest)=
          canonical_forecast_pipeline_scenario_method_closure_digest()
         FROM canonical_forecast_pipeline_scenario_method_registration
         WHERE version='m26_pipeline_open_value_scenario_bounded_v1') closure_current,
        has_table_privilege('public','canonical_forecast_pipeline_scenario_origins',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') public_table,
        has_function_privilege('public',
          'canonical_forecast_pipeline_scenario_origin_capture(uuid,uuid,text,uuid,text,text,text,boolean,text)',
          'EXECUTE') public_entry,
        pg_get_indexdef('canonical_forecast_pipeline_scenario_evaluations_recent'::regclass) indexdef`)).rows[0];
      expect(topology).toEqual({ local_triggers: 7, closure_current: true,
        public_table: false, public_entry: false,
        indexdef: 'CREATE INDEX canonical_forecast_pipeline_scenario_evaluations_recent ON public.canonical_forecast_pipeline_scenario_evaluations USING btree (organization_id, origin_id, revision DESC, id DESC)' });
      await expect(pool.query(
        `SELECT canonical_forecast_pipeline_scenario_test_clock_set(clock_timestamp())`))
        .rejects.toMatchObject({ code: '42501' });
      await expect(pool.query(`SELECT
        canonical_forecast_pipeline_scenario_weighted_micro(NULL,'preliminary_estimate',1)`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(pool.query(`SELECT
        canonical_forecast_pipeline_scenario_weighted_micro('[]'::jsonb,NULL,1)`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(pool.query(`SELECT
        canonical_forecast_pipeline_scenario_total_weighted_micro('[]'::jsonb,1,NULL)`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(pool.query(`SELECT canonical_forecast_pipeline_scenario_policy_mutate(
        NULL::uuid,NULL::uuid,'owner',NULL::uuid,NULL::text,'null-policy-proof-01',
        'approve','Reject a null scenario weight before any authority lookup.',0,
        NULL::integer,1,1,1,1,1,TRUE,'pipeline-scenario-policy-v1')`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(pool.query(`SELECT canonical_forecast_pipeline_scenario_origin_capture(
        NULL::uuid,NULL::uuid,'owner',NULL::uuid,NULL::text,'null-origin-proof-01',
        'Reject a null origin version before any authority lookup.',TRUE,NULL::text)`))
        .rejects.toMatchObject({ code: '22023' });
      await expect(pool.query(`SELECT canonical_forecast_pipeline_scenario_evaluation_capture(
        NULL::uuid,NULL::uuid,'owner',NULL::uuid,NULL::text,'null-evaluation-proof-01',
        '10000000-0000-4000-8000-000000000001'::uuid,
        'Reject a null evaluation version before any authority lookup.',TRUE,NULL::text)`))
        .rejects.toMatchObject({ code: '22023' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL northstar.m26_part6b_disposable_clock='enabled'");
        await client.query(
          `SELECT canonical_forecast_pipeline_scenario_test_clock_set('2030-01-01T00:00:00Z')`);
        await client.query('ROLLBACK');
      } finally { client.release(); }
      const bytes = fs.readFileSync(path.resolve(__dirname, '../../migrations', migration));
      expect((await pool.query(`SELECT trim(checksum) checksum FROM _migrations
        WHERE filename=$1`, [migration])).rows)
        .toEqual([{ checksum: digest(bytes) }]);
    }, 120000);
});

realPostgres('Mission 26 Part 6B fresh startup contract', () => {
  let database;
  let pool;
  let runtimeRole;
  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p6b-startup');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    runtimeRole = `m26_p6b_runtime_${process.pid}_${Date.now()}`;
    await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`);
    await db.runMigrations({ pool });
  }, 120000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (runtimeRole) {
      const admin = new Pool({ connectionString: process.env.M19_PG_ADMIN_URL, max: 1 });
      try { await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`); }
      finally { await admin.end(); }
    }
  }, 120000);

  test('independently verifies closure and restores only six guarded entries', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await db.grantAndVerifyRuntimeAuthorityForTests(client, { runtimeRole });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
    const acl = (await pool.query(`SELECT
      has_table_privilege($1,'canonical_forecast_pipeline_scenario_origins',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') table_access,
      has_sequence_privilege($1,'canonical_forecast_pipeline_estimate_source_sequence',
       'USAGE,SELECT,UPDATE') sequence_access,
      has_function_privilege($1,'canonical_forecast_pipeline_scenario_clock()','EXECUTE') clock,
      has_function_privilege($1,
       'canonical_forecast_pipeline_scenario_policy_mutate(uuid,uuid,text,uuid,text,text,text,text,integer,integer,integer,integer,integer,integer,integer,boolean,text)',
       'EXECUTE') policy,
      has_function_privilege($1,
       'canonical_forecast_pipeline_scenario_evaluation_read(uuid,uuid,text,uuid,uuid)',
       'EXECUTE') evaluation_read`, [runtimeRole])).rows[0];
    expect(acl).toEqual({ table_access: false, sequence_access: false,
      clock: false, policy: true, evaluation_read: true });

    await pool.query(`GRANT SELECT (private_output)
      ON canonical_forecast_pipeline_scenario_origins TO "${runtimeRole}"`);
    const repairClient = await pool.connect();
    try {
      await repairClient.query('BEGIN');
      await db.grantAndVerifyRuntimeAuthorityForTests(repairClient, { runtimeRole });
      await repairClient.query('COMMIT');
    } catch (error) {
      await repairClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { repairClient.release(); }
    expect((await pool.query(`SELECT has_column_privilege($1,
      'canonical_forecast_pipeline_scenario_origins','private_output','SELECT') allowed`,
    [runtimeRole])).rows[0].allowed).toBe(false);

    const runtimeClock = await pool.connect();
    try {
      await runtimeClock.query('BEGIN');
      await runtimeClock.query(`GRANT EXECUTE ON FUNCTION
        canonical_forecast_pipeline_scenario_test_clock_set(timestamptz) TO "${runtimeRole}"`);
      await runtimeClock.query(`SET LOCAL northstar.runtime_role='${runtimeRole}'`);
      await runtimeClock.query(`SET LOCAL ROLE "${runtimeRole}"`);
      await runtimeClock.query("SET LOCAL northstar.m26_part6b_disposable_clock='enabled'");
      await expect(runtimeClock.query(`SELECT
        canonical_forecast_pipeline_scenario_test_clock_set(clock_timestamp())`))
        .rejects.toMatchObject({ code: '42501' });
      await runtimeClock.query('ROLLBACK');
    } finally {
      await runtimeClock.query('ROLLBACK').catch(() => {});
      runtimeClock.release();
    }

    const expectStartupPoison = async (statement, pattern) => {
      const poisonClient = await pool.connect();
      try {
        await poisonClient.query('BEGIN');
        await poisonClient.query(statement);
        await expect(db.grantAndVerifyRuntimeAuthorityForTests(poisonClient, { runtimeRole }))
          .rejects.toThrow(pattern);
        await poisonClient.query('ROLLBACK');
      } finally {
        await poisonClient.query('ROLLBACK').catch(() => {});
        poisonClient.release();
      }
    };
    await expectStartupPoison(
      `ALTER TABLE canonical_forecast_pipeline_scenario_test_clock
        ADD COLUMN unexpected_column text`, /table schema is invalid/);
    await expectStartupPoison(
      `ALTER TABLE canonical_forecast_pipeline_scenario_test_clock
        ADD CONSTRAINT unexpected_constraint CHECK (current_at IS NOT NULL)`,
      /table schema is invalid/);
    await expectStartupPoison(
      `ALTER SEQUENCE canonical_forecast_pipeline_estimate_source_sequence
        INCREMENT BY 2`, /sequence topology is invalid/);
    await expectStartupPoison(
      `CREATE INDEX unexpected_pipeline_index
        ON canonical_forecast_pipeline_scenario_test_clock(current_at)`,
      /index set contains an extra index/);
    await expectStartupPoison(
      `DROP INDEX canonical_forecast_pipeline_scenario_evaluations_recent;
       CREATE TABLE canonical_forecast_pipeline_scenario_evaluations_recent(
         poison integer NOT NULL)`, /index topology is invalid/);
    await expectStartupPoison(
      `CREATE TRIGGER unexpected_pipeline_trigger BEFORE UPDATE
        ON canonical_forecast_pipeline_scenario_test_clock FOR EACH STATEMENT
        EXECUTE FUNCTION canonical_forecast_pipeline_scenario_immutable()`,
      /local trigger set is invalid/);
    await expectStartupPoison(
      `GRANT SELECT (private_output)
        ON canonical_forecast_pipeline_scenario_origins TO PUBLIC`,
      /PUBLIC isolation is missing/);
    await expectStartupPoison(
      `ALTER FUNCTION canonical_forecast_pipeline_scenario_policy_read(
        uuid,uuid,text,uuid) OWNER TO "${runtimeRole}"`,
      /function security is missing/);

    await pool.query(`UPDATE canonical_forecast_pipeline_scenario_method_registration
      SET dependency_closure_digest=dependency_closure_digest`)
      .catch(() => {});
    const poison = await pool.connect();
    try {
      await poison.query('BEGIN');
      await poison.query(`ALTER TABLE canonical_forecast_pipeline_scenario_origins
        DISABLE TRIGGER canonical_forecast_pipeline_scenario_origins_immutable`);
      await expect(db.grantAndVerifyRuntimeAuthorityForTests(poison, { runtimeRole }))
        .rejects.toThrow(/pipeline scenario local trigger set is invalid/);
      await poison.query('ROLLBACK');
    } finally { poison.release(); }
  }, 120000);
});
