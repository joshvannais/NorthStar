'use strict';

const { Client, Pool } = require('pg');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { reviewedMigrationTimeoutValues } = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 price-order migration recovery', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('migration 146 has bounded startup limits and rolls back cleanly on an active M24 writer lock', async () => {
    const migration = '146_canonical_forecast_price_decision_order.sql';
    expect(reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '0', statement_timeout: '0' }))
      .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
    expect(reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '200', statement_timeout: '1000' }))
      .toEqual({ lockTimeout: '200ms', statementTimeout: '1000ms' });

    // Recreate migration 146 as pending without dropping the released
    // authority out from under later migrations that now depend on it. The
    // renamed authority stays reachable by OID for those later objects while
    // 146 proves that it can install a fresh exact-name authority after the
    // bounded lock failure. This database is disposable.
    await fixture.ownerPool.query(`ALTER TRIGGER
      canonical_forecast_price_decision_order_insert
      ON public.canonical_estimate_decisions RENAME TO
      canonical_forecast_price_decision_order_insert_pre146_test`);
    await fixture.ownerPool.query(`ALTER FUNCTION
      public.canonical_forecast_price_decision_order_insert() RENAME TO
      canonical_forecast_price_decision_order_insert_pre146_test`);
    await fixture.ownerPool.query(`ALTER INDEX
      public.canonical_forecast_price_decision_orders_tenant_order_idx RENAME TO
      canonical_forecast_price_decision_orders_tenant_order_idx_pre146_test`);
    await fixture.ownerPool.query(`ALTER INDEX
      public.canonical_forecast_price_decision_orders_tenant_time_idx RENAME TO
      canonical_forecast_price_decision_orders_tenant_time_idx_pre146_test`);
    await fixture.ownerPool.query(`ALTER INDEX
      public.canonical_forecast_price_decision_orders_pkey RENAME TO
      canonical_forecast_price_decision_orders_pkey_pre146_test`);
    await fixture.ownerPool.query(`DO $rename_pre146_unique_index$
      DECLARE index_name TEXT;
      BEGIN
        SELECT index_class.relname INTO STRICT index_name
        FROM pg_index index_record
        JOIN pg_class index_class ON index_class.oid=index_record.indexrelid
        WHERE index_record.indrelid=
          'public.canonical_forecast_price_decision_orders'::regclass
          AND index_record.indisunique AND NOT index_record.indisprimary;
        EXECUTE format('ALTER INDEX public.%I RENAME TO %I',index_name,
          'm26_pre146_unique_idx');
      END
      $rename_pre146_unique_index$`);
    await fixture.ownerPool.query(`ALTER TABLE
      public.canonical_forecast_price_decision_orders RENAME TO
      canonical_forecast_price_decision_orders_pre146_test`);
    await fixture.ownerPool.query(`ALTER FUNCTION
      public.canonical_forecast_price_decision_order_immutable() RENAME TO
      canonical_forecast_price_decision_order_immutable_pre146_test`);
    await fixture.ownerPool.query(`ALTER SEQUENCE
      public.canonical_forecast_price_decision_order_sequence RENAME TO
      canonical_forecast_price_decision_order_sequence_pre146_test`);
    await fixture.ownerPool.query(
      'DELETE FROM public._migrations WHERE filename=$1', [migration]);

    // Migration 212 now adds a bounded read index to migration 146's table.
    // A database-local test event trigger recreates that later index as soon
    // as the fresh 146 table exists, so the current startup verifier can run
    // after the historical migration retry without weakening either frozen
    // migration. The disposable database and finally block contain it.
    const adminUrl = new URL(process.env.M19_PG_ADMIN_URL);
    adminUrl.pathname = new URL(fixture.ownerPool.options.connectionString).pathname;
    const eventAdmin = new Client({ connectionString: adminUrl.toString() });
    await eventAdmin.connect();
    await fixture.ownerPool.query(`CREATE FUNCTION public.m26_pre146_test_later_index()
      RETURNS event_trigger LANGUAGE plpgsql AS $event_function$
      BEGIN
        IF to_regclass('public.canonical_forecast_price_decision_orders') IS NOT NULL
           AND to_regclass('public.canonical_forecast_price_decision_orders_tenant_time_idx') IS NULL THEN
          CREATE INDEX canonical_forecast_price_decision_orders_tenant_time_idx
          ON public.canonical_forecast_price_decision_orders(
            organization_id,ordered_at,source_order)
          INCLUDE(estimate_id,decision_id);
        END IF;
      END
      $event_function$`);
    await eventAdmin.query(`CREATE EVENT TRIGGER m26_pre146_test_later_index
      ON ddl_command_end WHEN TAG IN ('CREATE TABLE')
      EXECUTE FUNCTION public.m26_pre146_test_later_index()`);

    const migrationPool = new Pool({
      connectionString: fixture.ownerPool.options.connectionString,
      options: '-c lock_timeout=200ms -c statement_timeout=1000ms', max: 1,
    });
    const holder = await fixture.ownerPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'LOCK TABLE public.canonical_estimate_decisions IN ROW EXCLUSIVE MODE');
      const started = Date.now();
      await expect(fixture.db.runMigrations({ pool: migrationPool,
        runtimePool: fixture.runtimePool })).rejects.toThrow(/lock timeout/);
      expect(Date.now() - started).toBeLessThan(3000);
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer AS n FROM public._migrations WHERE filename=$1',
        [migration])).rows[0].n).toBe(0);
      expect((await fixture.ownerPool.query(
        "SELECT to_regclass('public.canonical_forecast_price_decision_orders') AS table_name"
      )).rows[0].table_name).toBeNull();
      await holder.query('COMMIT');

      await expect(fixture.db.runMigrations({ pool: migrationPool,
        runtimePool: fixture.runtimePool })).resolves.toBe(true);
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer AS n FROM public._migrations WHERE filename=$1',
        [migration])).rows[0].n).toBe(1);
      expect((await fixture.ownerPool.query(
        "SELECT to_regclass('public.canonical_forecast_price_decision_orders') AS table_name"
      )).rows[0].table_name).not.toBeNull();
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
      await migrationPool.end();
      await eventAdmin.query(
        'DROP EVENT TRIGGER IF EXISTS m26_pre146_test_later_index').catch(() => {});
      await eventAdmin.query(
        'DROP FUNCTION IF EXISTS public.m26_pre146_test_later_index()').catch(() => {});
      await eventAdmin.end().catch(() => {});
    }
  }, 120000);

  test('migration 149 bounds the startup advisory wait and retries once after release', async () => {
    const migration = '149_canonical_forecast_price_preanchor_lineage.sql';
    expect(reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '0', statement_timeout: '0' }))
      .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
    expect(reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '200', statement_timeout: '1000' }))
      .toEqual({ lockTimeout: '200ms', statementTimeout: '1000ms' });

    // Recreate the pre-149 pending state only in this disposable database.
    // The first retry must time out before DDL and leave the row absent.
    await fixture.ownerPool.query(
      'DROP FUNCTION public.canonical_forecast_price_preanchor_context(uuid,bigint,jsonb)');
    await fixture.ownerPool.query(
      'DELETE FROM public._migrations WHERE filename=$1', [migration]);
    const migrationPool = new Pool({
      connectionString: fixture.ownerPool.options.connectionString,
      options: '-c lock_timeout=200ms -c statement_timeout=1000ms', max: 1,
    });
    const holder = await fixture.ownerPool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1::bigint)',
        ['5643944089238424905']);
      const started = Date.now();
      await expect(fixture.db.runMigrations({ pool: migrationPool,
        runtimePool: fixture.runtimePool })).rejects.toThrow(/lock timeout/);
      expect(Date.now() - started).toBeLessThan(3000);
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer AS n FROM public._migrations WHERE filename=$1',
        [migration])).rows[0].n).toBe(0);
      await holder.query('SELECT pg_advisory_unlock($1::bigint)',
        ['5643944089238424905']);
      await expect(fixture.db.runMigrations({ pool: migrationPool,
        runtimePool: fixture.runtimePool })).resolves.toBe(true);
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer AS n FROM public._migrations WHERE filename=$1',
        [migration])).rows[0].n).toBe(1);
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1::bigint)',
        ['5643944089238424905']).catch(() => {});
      holder.release();
      await migrationPool.end();
    }
  }, 120000);
});
