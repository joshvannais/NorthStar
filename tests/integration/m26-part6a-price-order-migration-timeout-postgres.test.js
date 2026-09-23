'use strict';

const { Pool } = require('pg');
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

    // Recreate the already-applied last migration as a pending migration in
    // this disposable database. No production schema or migration is changed.
    await fixture.ownerPool.query(
      `DROP TRIGGER canonical_forecast_price_decision_order_insert
       ON public.canonical_estimate_decisions`);
    await fixture.ownerPool.query(
      'DROP FUNCTION public.canonical_forecast_price_decision_order_insert()');
    await fixture.ownerPool.query(
      `DROP TRIGGER canonical_forecast_price_decision_order_immutable
       ON public.canonical_forecast_price_decision_orders`);
    await fixture.ownerPool.query(
      'DROP FUNCTION public.canonical_forecast_price_decision_order_immutable()');
    await fixture.ownerPool.query(
      'DROP TABLE public.canonical_forecast_price_decision_orders');
    await fixture.ownerPool.query(
      'DROP SEQUENCE public.canonical_forecast_price_decision_order_sequence');
    await fixture.ownerPool.query(
      'DELETE FROM public._migrations WHERE filename=$1', [migration]);

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
