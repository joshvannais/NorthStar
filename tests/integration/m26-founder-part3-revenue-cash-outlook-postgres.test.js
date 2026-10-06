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
});
