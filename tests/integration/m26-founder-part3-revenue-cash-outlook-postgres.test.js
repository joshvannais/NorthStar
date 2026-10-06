'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const db = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migration = '236_canonical_forecast_revenue_cash_outlook.sql';

function copyMigrations(maximum) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m26-founder-p3-'));
  const source = path.resolve(__dirname, '../../migrations');
  for (const name of fs.readdirSync(source)
    .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= maximum)) {
    fs.copyFileSync(path.join(source, name), path.join(directory, name));
  }
  return directory;
}

async function waitForLockWait(pool, pid) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const state = (await pool.query(
      `SELECT count(*) FILTER(WHERE locktype='advisory' AND granted)::int advisory_granted,
        count(*) FILTER(WHERE NOT granted)::int waiting
       FROM pg_locks WHERE pid=$1`, [pid])).rows[0];
    if (state && state.advisory_granted >= 7 && state.waiting >= 1) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Backend ${pid} did not enter a lock wait`);
}

function readOutlook(client, fixture) {
  const actor = fixture.actors.owner;
  return client.query(
    `SELECT public.canonical_forecast_revenue_cash_outlook_current($1,$2,$3,$4) value`,
    [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
}

realPostgres('Mission 26 founder Part 3 migration 235 to 236 upgrade', () => {
  let database;
  let pool;
  let directory;
  beforeAll(async () => {
    database = await createSuiteDatabase('m26-founder-p3-up');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    directory = copyMigrations(235);
    await db.runMigrations({ pool, migrationsDirectory: directory });
  }, 180000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (directory && path.dirname(directory) === os.tmpdir() &&
        path.basename(directory).startsWith('northstar-m26-founder-p3-')) {
      fs.rmSync(directory, { recursive: true });
    }
  }, 120000);

  test('adds only the minimized read and preserves predecessor migration receipts', async () => {
    const before = (await pool.query(`SELECT filename,trim(checksum) checksum
      FROM _migrations WHERE filename IN (
       '116_canonical_external_financial_import_authority.sql',
       '120_canonical_external_financial_outcomes.sql',
       '234_canonical_forecast_integrated_commercial_baseline.sql',
       '235_canonical_forecast_pipeline_scenarios.sql') ORDER BY filename`)).rows;
    fs.copyFileSync(path.resolve(__dirname, '../../migrations', migration),
      path.join(directory, migration));
    await expect(db.runMigrations({ pool, migrationsDirectory: directory })).resolves.toBe(true);
    const topology = (await pool.query(`SELECT
      to_regprocedure('canonical_forecast_revenue_cash_outlook_current(uuid,uuid,text,uuid)')::text routine,
      (SELECT routine.prosecdef AND routine.proconfig @>
        ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
       FROM pg_proc routine WHERE routine.oid=
        'canonical_forecast_revenue_cash_outlook_current(uuid,uuid,text,uuid)'::regprocedure) security,
      has_function_privilege('public',
        'canonical_forecast_revenue_cash_outlook_current(uuid,uuid,text,uuid)','EXECUTE') public_execute,
      (SELECT count(*)::int FROM _migrations WHERE filename=$1) receipt`, [migration])).rows[0];
    expect(topology).toEqual({
      routine: 'canonical_forecast_revenue_cash_outlook_current(uuid,uuid,text,uuid)',
      security: true, public_execute: false, receipt: 1,
    });
    expect((await pool.query(`SELECT filename,trim(checksum) checksum
      FROM _migrations WHERE filename IN (
       '116_canonical_external_financial_import_authority.sql',
       '120_canonical_external_financial_outcomes.sql',
       '234_canonical_forecast_integrated_commercial_baseline.sql',
       '235_canonical_forecast_pipeline_scenarios.sql') ORDER BY filename`)).rows).toEqual(before);
    expect(db.reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '0', statement_timeout: '0' }))
      .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
  }, 180000);
});

realPostgres('Mission 26 founder Part 3 fresh mounted refusal contract', () => {
  let fixture;
  beforeAll(async () => { fixture = await createEstimateReviewFixture(); }, 180000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('distinguishes missing current evidence from zero and enforces role/tenant authority', async () => {
    const endpoint = '/api/v1/forecast/revenue-cash-outlook/current';
    const owner = await request(fixture.app).get(endpoint)
      .set('Cookie', fixture.actors.owner.session.headers.Cookie);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toBe('private, no-store');
    expect(owner.body.data).toMatchObject({
      version: 'm26-revenue-cash-outlook-v1', state: 'unavailable',
      reason: 'commercial_baseline_unavailable', currency: null,
      authorizedEstimate: { state: 'unavailable', amountBeforeTax: null },
      approvedPrice: { state: 'unavailable', amountBeforeTax: null },
      bookedWork: { state: 'unavailable', amountBeforeTax: null, classification: 'committed' },
      cashTiming: { state: 'unavailable', amount: null,
        reason: 'financial_period_coverage_unavailable' },
      earnedRevenue: { state: 'unavailable', amount: null,
        reason: 'recognition_authority_unavailable' },
      forecastIssued: false, automaticActionAuthorized: false,
    });
    expect(JSON.stringify(owner.body)).not.toMatch(/positionId|originId|digest|members|privateOutput|weightsPpm/);
    expect((await request(fixture.app).get(endpoint)
      .set('Cookie', fixture.actors.member.session.headers.Cookie)).status).toBe(403);
    const other = await request(fixture.app).get(endpoint)
      .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie);
    expect(other.status).toBe(200);
    expect(other.body.data.reason).toBe('commercial_baseline_unavailable');
    expect((await request(fixture.app).get(endpoint + '?organizationId=' + fixture.org)
      .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie)).status).toBe(400);
  }, 120000);

  test('reauthenticates the missing-baseline refusal after concurrent session revocation', async () => {
    const holder = await fixture.ownerPool.connect();
    const reader = await fixture.runtimePool.connect();
    let pending;
    try {
      await holder.query('BEGIN');
      await holder.query(
        'LOCK TABLE public.canonical_forecast_integrated_commercial_positions IN ACCESS EXCLUSIVE MODE');
      const pid = Number((await reader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      pending = readOutlook(reader, fixture).catch(error => error);
      await waitForLockWait(fixture.ownerPool, pid);
      await fixture.ownerPool.query(
        `UPDATE public.auth_sessions SET status='revoked',revoked_at=clock_timestamp(),
          revoke_reason='m26_founder_part3_missing_baseline_race' WHERE id=$1`,
        [fixture.actors.owner.authSessionId]);
      await holder.query('COMMIT');
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome.code).toBe('42501');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      if (pending) await pending.catch(() => {});
      await fixture.ownerPool.query(
        `UPDATE public.auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL
          WHERE id=$1`, [fixture.actors.owner.authSessionId]);
      reader.release();
      holder.release();
    }
  }, 120000);

  test('reauthenticates the not-current-baseline refusal after concurrent membership revocation', async () => {
    const actor = fixture.actors.owner;
    const stalePosition = {
      state: 'northstar_integrated_commercial_baseline',
      sourceCohortsCompleteAtCapture: true,
      captureTimeEquivalentVerified: true,
      futureApprovedPriceBaselineVerified: true,
      earnedRevenueMeasured: false,
      collectedCashMeasured: false,
      forecastIssued: false,
    };
    const sourceReceipt = (await fixture.ownerPool.query(
      `WITH value AS (SELECT gen_random_uuid() id,gen_random_uuid() nonce,
        clock_timestamp() captured)
       INSERT INTO public.canonical_forecast_price_ordered_receipts(
        id,organization_id,coverage_start_order,high_water_order,decision_events,digest_nonce,
        snapshot_digest,actor_user_id,membership_id,auth_session_id,request_key_hash,captured_at)
       SELECT id,$1,0,0,'[]'::jsonb,nonce,
        public.canonical_completion_digest(jsonb_build_object(
         'version','m26-price-ordered-source-v1','organizationId',$1::uuid,
         'coverageStartOrder',0,'highWaterOrder',0,'digestNonce',nonce,
         'capturedAt',public.canonical_forecast_utc_instant(captured),'events','[]'::jsonb)),
        $2,$2,$3,repeat('d',64),captured FROM value RETURNING id`,
      [fixture.org, actor.actorUserId, actor.authSessionId])).rows[0].id;
    const originOutput = {
      target: { key: 'revenue.approved_price_flow' },
      confidence: { state: 'unavailable' }, value: { kind: 'point' },
    };
    const seed = await fixture.ownerPool.connect();
    let futureOrigin;
    try {
      await seed.query(
        'ALTER TABLE public.canonical_forecast_price_flow_saved_origins DISABLE TRIGGER USER');
      futureOrigin = (await seed.query(
        `WITH value AS (SELECT clock_timestamp() saved,
          date_trunc('day',clock_timestamp()+INTERVAL '2 days') horizon)
         INSERT INTO public.canonical_forecast_price_flow_saved_origins(
          organization_id,saved_at,horizon_start,horizon_end,source_receipt_id,output,
          receipt_digest,actor_user_id,auth_session_id,request_key_hash,request_digest)
         SELECT $1,saved,horizon,horizon+INTERVAL '1 day',$4,$5::jsonb,
          public.canonical_completion_digest($5::jsonb),$2,$3,repeat('e',64),repeat('f',64)
         FROM value RETURNING id`,
        [fixture.org, actor.actorUserId, actor.authSessionId, sourceReceipt,
          originOutput])).rows[0].id;
    } finally {
      await seed.query(
        'ALTER TABLE public.canonical_forecast_price_flow_saved_origins ENABLE TRIGGER USER');
      seed.release();
    }
    await fixture.ownerPool.query(
      `INSERT INTO public.canonical_forecast_integrated_commercial_positions(
        organization_id,captured_at,source_digest,future_origin_id,position,position_digest,
        actor_user_id,membership_id,auth_session_id,reason,request_key_hash,request_digest)
       VALUES($1,clock_timestamp(),repeat('a',64),$5,$4::jsonb,
        public.canonical_completion_digest($4::jsonb),$2,$2,$3,
        'Synthetic stale baseline for final reauthentication coverage',repeat('b',64),repeat('c',64))`,
      [fixture.org, actor.actorUserId, actor.authSessionId, stalePosition, futureOrigin]);
    await fixture.ownerPool.query(`
      CREATE OR REPLACE FUNCTION public.canonical_forecast_integrated_commercial_position_read(
       org UUID,actor UUID,role_value TEXT,session_value UUID,position_value UUID)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $test$
      BEGIN
       PERFORM pg_advisory_lock(hashtextextended(
        'm26:test:outlook-not-current:'||org::text,0));
       PERFORM pg_advisory_unlock(hashtextextended(
        'm26:test:outlook-not-current:'||org::text,0));
       RETURN jsonb_build_object('state','test_not_current',
        'sourceCurrent',FALSE,'currentAtRead',FALSE);
      END $test$`);

    const holder = await fixture.ownerPool.connect();
    const reader = await fixture.runtimePool.connect();
    let pending;
    try {
      await holder.query(
        `SELECT pg_advisory_lock(hashtextextended(
          'm26:test:outlook-not-current:'||$1::text,0))`, [fixture.org]);
      const pid = Number((await reader.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      pending = readOutlook(reader, fixture).catch(error => error);
      await waitForLockWait(fixture.ownerPool, pid);
      await fixture.ownerPool.query(
        `UPDATE public.organization_memberships SET status='revoked',revoked_at=clock_timestamp()
          WHERE organization_id=$1 AND user_id=$2`, [fixture.org, actor.actorUserId]);
      await holder.query(
        `SELECT pg_advisory_unlock(hashtextextended(
          'm26:test:outlook-not-current:'||$1::text,0))`, [fixture.org]);
      const outcome = await pending;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome.code).toBe('42501');
    } finally {
      await holder.query(
        `SELECT pg_advisory_unlock(hashtextextended(
          'm26:test:outlook-not-current:'||$1::text,0))`, [fixture.org]).catch(() => {});
      if (pending) await pending.catch(() => {});
      await fixture.ownerPool.query(
        `UPDATE public.organization_memberships SET status='active',revoked_at=NULL
          WHERE organization_id=$1 AND user_id=$2`, [fixture.org, actor.actorUserId]);
      reader.release();
      holder.release();
    }
  }, 120000);
});
