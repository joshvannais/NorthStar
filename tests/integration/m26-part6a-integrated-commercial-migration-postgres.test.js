'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { reviewedMigrationTimeoutValues } = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A migration 233 to 234 rolling upgrade', () => {
  let database;
  let pool;
  let migrationDirectory;
  const db = require('../../src/db');
  const migration = '234_canonical_forecast_integrated_commercial_baseline.sql';

  beforeAll(async () => {
    database = await createSuiteDatabase('m26-p6a-upgrade');
    pool = new Pool({ connectionString: database.connectionString, max: 6 });
    migrationDirectory = fs.mkdtempSync(path.join(os.tmpdir(),
      'northstar-m26-p6a-pre234-'));
    const source = path.resolve(__dirname, '../../migrations');
    for (const name of fs.readdirSync(source)
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 233)) {
      fs.copyFileSync(path.join(source, name), path.join(migrationDirectory, name));
    }
    await db.runMigrations({ pool, migrationsDirectory: migrationDirectory });
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrationDirectory && path.dirname(migrationDirectory) === os.tmpdir() &&
        path.basename(migrationDirectory).startsWith('northstar-m26-p6a-pre234-')) {
      fs.rmSync(migrationDirectory, { recursive: true });
    }
  }, 120000);

  test('drains pre-install writers, rolls back a bounded timeout, and retries once',
    async () => {
      expect(reviewedMigrationTimeoutValues(migration,
        { lock_timeout: '0', statement_timeout: '0' }))
        .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
      expect(reviewedMigrationTimeoutValues(migration,
        { lock_timeout: '200', statement_timeout: '1000' }))
        .toEqual({ lockTimeout: '200ms', statementTimeout: '1000ms' });

      const before = (await pool.query(`SELECT
        pg_get_functiondef('canonical_forecast_approved_estimate_v2_gap(uuid,timestamptz)'::regprocedure) approved_gap,
        pg_get_functiondef('canonical_forecast_booked_work_confirmation_currentness(uuid,uuid,text,uuid,uuid)'::regprocedure) booked_currentness`)).rows[0];
      const source = path.resolve(__dirname, '../../migrations');
      fs.copyFileSync(path.join(source, migration),
        path.join(migrationDirectory, migration));
      const holder = await pool.connect();
      const preInstallIssued = await pool.connect();
      const preInstallConfirmation = await pool.connect();
      const boundedPool = new Pool({ connectionString: database.connectionString,
        options: '-c lock_timeout=200ms -c statement_timeout=1000ms', max: 1 });
      try {
        // This READ COMMITTED transaction begins before migration 234 but does
        // not touch either fenced source relation until after installation.
        await preInstallIssued.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await preInstallConfirmation.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await holder.query('BEGIN');
        // This is the exact lock class held by INSERT writers before migration
        // 234 installs their tenant source fence.
        await holder.query(`LOCK TABLE canonical_customer_estimate_versions,
          canonical_forecast_booked_work_confirmations IN ROW EXCLUSIVE MODE`);
        await expect(db.runMigrations({ pool: boundedPool,
          migrationsDirectory: migrationDirectory })).rejects.toThrow(/lock timeout/);
        expect((await pool.query(`SELECT count(*)::int count FROM _migrations
          WHERE filename=$1`, [migration])).rows[0].count).toBe(0);
        expect((await pool.query(`SELECT
          to_regclass('canonical_forecast_integrated_commercial_positions') relation,
          to_regprocedure('canonical_forecast_integrated_issued_source_fence()') fence`))
          .rows[0]).toEqual({ relation: null, fence: null });
        await holder.query('COMMIT');

        await expect(db.runMigrations({ pool: boundedPool,
          migrationsDirectory: migrationDirectory })).resolves.toBe(true);

        // Statements issued by transactions that began before the DDL commit
        // must discover and execute the newly installed production triggers.
        // Each intentionally incomplete row waits on the new tenant fence,
        // then reaches its existing NOT NULL checks only after the fence is
        // released. This proves both exact source bindings protect old
        // READ COMMITTED transactions that had not touched the relations.
        const sourceFenceHolder = await pool.connect();
        try {
          await sourceFenceHolder.query('BEGIN');
          const issuedOrganizationId = '11111111-1111-4111-8111-111111111111';
          const confirmationOrganizationId = '22222222-2222-4222-8222-222222222222';
          const issuedBackend = (await preInstallIssued.query(
            'SELECT pg_backend_pid() pid')).rows[0].pid;
          const confirmationBackend = (await preInstallConfirmation.query(
            'SELECT pg_backend_pid() pid')).rows[0].pid;
          await sourceFenceHolder.query(`SELECT pg_advisory_xact_lock(
            hashtextextended('m26:commercial-booking-order:'||source_id::text,0))
            FROM unnest($1::uuid[]) source_id`,
          [[issuedOrganizationId, confirmationOrganizationId]]);
          let issuedSettled = false;
          let confirmationSettled = false;
          const postInstallIssued = preInstallIssued.query(
            'INSERT INTO canonical_customer_estimate_versions(organization_id) VALUES($1)',
            [issuedOrganizationId]).then(result => {
            issuedSettled = true;
            return { result };
          }, error => {
            issuedSettled = true;
            return { error };
          });
          const postInstallConfirmation = preInstallConfirmation.query(
            'INSERT INTO canonical_forecast_booked_work_confirmations(organization_id) VALUES($1)',
            [confirmationOrganizationId]).then(result => {
            confirmationSettled = true;
            return { result };
          }, error => {
            confirmationSettled = true;
            return { error };
          });
          const waitDeadline = Date.now() + 4000;
          let advisoryWaiters = 0;
          while (Date.now() < waitDeadline && advisoryWaiters < 2) {
            advisoryWaiters = (await pool.query(`SELECT count(*)::int count
              FROM pg_locks WHERE locktype='advisory' AND NOT granted AND
              pid=ANY($1::int[]) AND
              database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
            [[issuedBackend, confirmationBackend]]))
              .rows[0].count;
            if (advisoryWaiters < 2) {
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
          expect(advisoryWaiters).toBeGreaterThanOrEqual(2);
          expect(issuedSettled).toBe(false);
          expect(confirmationSettled).toBe(false);
          await sourceFenceHolder.query('COMMIT');
          expect((await postInstallIssued).error).toMatchObject({ code: '23502' });
          expect((await postInstallConfirmation).error).toMatchObject({ code: '23502' });
        } finally {
          await sourceFenceHolder.query('ROLLBACK').catch(() => {});
          sourceFenceHolder.release();
        }
      } finally {
        await preInstallIssued.query('ROLLBACK').catch(() => {});
        preInstallIssued.release();
        await preInstallConfirmation.query('ROLLBACK').catch(() => {});
        preInstallConfirmation.release();
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
        await boundedPool.end();
      }

      expect((await pool.query(`SELECT filename FROM _migrations
        WHERE filename=$1`, [migration])).rows.map(row => row.filename))
        .toEqual([migration]);
      expect((await pool.query(`SELECT
        to_regclass('canonical_forecast_integrated_commercial_positions')::text relation,
        to_regprocedure('canonical_forecast_integrated_source_bound(text,integer,integer)')::text source_bound,
        to_regprocedure('canonical_forecast_integrated_commercial_sources(uuid,uuid,text,uuid,text)')::text sources,
        to_regprocedure('canonical_forecast_capture_integrated_commercial_position(uuid,uuid,text,uuid,text,uuid,text,text,boolean,text)')::text capture,
        to_regprocedure('canonical_forecast_integrated_commercial_position_read(uuid,uuid,text,uuid,uuid)')::text read,
        to_regprocedure('canonical_forecast_integrated_commercial_closure_digest()')::text closure,
        (SELECT registration.dependency_closure_digest=
          canonical_forecast_integrated_commercial_closure_digest()
          FROM canonical_forecast_integrated_method_registration registration
          WHERE registration.version='m26_integrated_commercial_price_closure_v1') registration_current,
        (SELECT routine.prosecdef AND routine.proconfig @>
          ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
          FROM pg_proc routine WHERE routine.oid=
           'canonical_forecast_integrated_commercial_closure_digest()'::regprocedure)
          closure_security,
        has_function_privilege('public',
          'canonical_forecast_integrated_commercial_closure_digest()','EXECUTE')
          public_closure_execute,
        pg_get_indexdef('canonical_forecast_integrated_commercial_positions_recent'::regclass) indexdef,
        (SELECT tgtype FROM pg_trigger WHERE
          tgrelid='canonical_customer_estimate_versions'::regclass AND
          tgname='canonical_forecast_integrated_issued_source_fence') issued_trigger_type,
        (SELECT tgtype FROM pg_trigger WHERE
          tgrelid='canonical_forecast_booked_work_confirmations'::regclass AND
          tgname='canonical_forecast_integrated_confirmation_source_fence') confirmation_trigger_type,
        (SELECT tgtype FROM pg_trigger WHERE
          tgrelid='canonical_forecast_integrated_commercial_positions'::regclass AND
          tgname='canonical_forecast_integrated_commercial_immutable') immutable_trigger_type`))
        .rows[0]).toEqual({
        relation: 'canonical_forecast_integrated_commercial_positions',
        source_bound: 'canonical_forecast_integrated_source_bound(text,integer,integer)',
        sources: 'canonical_forecast_integrated_commercial_sources(uuid,uuid,text,uuid,text)',
        capture: 'canonical_forecast_capture_integrated_commercial_position(uuid,uuid,text,uuid,text,uuid,text,text,boolean,text)',
        read: 'canonical_forecast_integrated_commercial_position_read(uuid,uuid,text,uuid,uuid)',
        closure: 'canonical_forecast_integrated_commercial_closure_digest()',
        registration_current: true, closure_security: true,
        public_closure_execute: false,
        indexdef: 'CREATE INDEX canonical_forecast_integrated_commercial_positions_recent ON public.canonical_forecast_integrated_commercial_positions USING btree (organization_id, captured_at DESC, id DESC)',
        issued_trigger_type: 7, confirmation_trigger_type: 7,
        immutable_trigger_type: 58,
      });
      expect((await pool.query(`SELECT
        pg_get_functiondef('canonical_forecast_approved_estimate_v2_gap(uuid,timestamptz)'::regprocedure) approved_gap,
        pg_get_functiondef('canonical_forecast_booked_work_confirmation_currentness(uuid,uuid,text,uuid,uuid)'::regprocedure) booked_currentness`)).rows[0])
        .toEqual(before);
      const bounds = (await pool.query(`SELECT source_kind,
        canonical_forecast_integrated_source_bound(source_kind,1000,262144) exact,
        canonical_forecast_integrated_source_bound(source_kind,1001,262144) count_over,
        canonical_forecast_integrated_source_bound(source_kind,1000,262145) manifest_over
        FROM unnest(ARRAY['approved_price','issued_current','issued_history',
          'commercial_review','confirmation_history']) source_kind
        ORDER BY source_kind`)).rows;
      expect(bounds).toEqual([
        { source_kind: 'approved_price', exact: null,
          count_over: 'approved_price_source_limit',
          manifest_over: 'approved_price_manifest_size' },
        { source_kind: 'commercial_review', exact: null,
          count_over: 'commercial_review_source_limit',
          manifest_over: 'booked_work_manifest_size' },
        { source_kind: 'confirmation_history', exact: null,
          count_over: 'booked_work_confirmation_source_limit',
          manifest_over: 'booked_work_manifest_size' },
        { source_kind: 'issued_current', exact: null,
          count_over: 'issued_estimate_source_limit',
          manifest_over: 'issued_estimate_manifest_size' },
        { source_kind: 'issued_history', exact: null,
          count_over: 'issued_estimate_history_source_limit',
          manifest_over: 'issued_estimate_manifest_size' },
      ]);
    }, 120000);
});
