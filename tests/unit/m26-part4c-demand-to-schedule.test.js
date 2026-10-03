'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const { createForecastDemandToScheduleRouter, safeOrigin, safeEvaluation } =
  require('../../src/routes/forecastDemandToSchedule');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const ORIGIN = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-part4c-test-key-0001';
const CUTOFF = '2026-10-01T12:00:00.000000Z';
const HORIZON = '2026-10-31T12:00:00.000000Z';

function seasonal(extra = {}) {
  return { state: 'seasonal_origin_current', id: ID,
    localHorizonStart: '2026-11-01', horizonStartsAt: '2026-11-01T04:00:00.000000Z',
    horizonEndsAt: '2026-12-01T05:00:00.000000Z', seasonalSignalState: 'repeated_high',
    researchOnly: true, amountWithheld: true, outputDigestWithheld: true,
    forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
    ...extra };
}
function pipeline(extra = {}) {
  return { state: 'pipeline_origin_current', id: ID, predictionCutoffAt: CUTOFF,
    horizonEndsAt: HORIZON, researchOnly: true, countWithheld: true,
    outputDigestWithheld: true, forecastIssued: false, paidNumericServing: false,
    forecastServingEnabled: false, ...extra };
}
function evaluation(kind = 'pipeline', extra = {}) {
  return { state: `${kind}_evaluation_current`, id: ID, originId: ORIGIN, revision: 1,
    evaluatedAt: HORIZON, researchOnly: true, metricsWithheld: true,
    forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
    ...extra };
}

function application({ role = 'owner', values = {}, databaseError } = {}) {
  const app = express();
  app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER }; req.orgId = ORG;
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.userRole = role; req.authSession = { id: SESSION }; next();
  };
  const client = { query: jest.fn(async sql => {
    if (databaseError && sql.startsWith('SELECT public.')) throw databaseError;
    if (!sql.startsWith('SELECT public.')) return { rows: [] };
    for (const [needle, value] of Object.entries(values)) {
      if (sql.includes(needle)) return { rows: [{ value }] };
    }
    return { rows: [{ value: null }] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  const bypass = (_req, _res, next) => next();
  app.use('/api/v1/forecast/demand-to-schedule', createForecastDemandToScheduleRouter({
    auth, throttle: bypass, writeThrottle: bypass, poolProvider: () => pool,
  }));
  return { app, client, pool };
}

describe('Mission 26 Part 4C demand-to-schedule route boundary', () => {
  test('projects seasonal and pipeline research without private numeric output', () => {
    expect(safeOrigin(seasonal(), 'seasonal', ID)).toEqual(seasonal());
    expect(safeOrigin(pipeline(), 'pipeline', ID)).toEqual(pipeline());
    for (const poison of [
      { privatePoint: '7.2' }, { expectedCount: '4.0' }, { outputDigest: DIGEST },
      { privateOutput: { expectedCount: 4 } }, { periods: [] }, { members: [] },
    ]) {
      expect(safeOrigin({ ...pipeline(), ...poison }, 'pipeline', ID)).toBeNull();
    }
    expect(safeOrigin({ ...pipeline(), paidNumericServing: true }, 'pipeline')).toBeNull();
    expect(safeOrigin({ ...seasonal(), localHorizonStart: '2026-11-02' }, 'seasonal'))
      .toBeNull();
  });

  test('projects append-only evaluation identity and rejects metric poison', () => {
    expect(safeEvaluation(evaluation(), 'pipeline', ORIGIN)).toEqual(evaluation());
    for (const poison of [{ actualFirstBookedCount: 2 }, { actualLeadCount: 5 },
      { absoluteError: 1 }, { privateMetrics: { error: 1 } }]) {
      expect(safeEvaluation({ ...evaluation(), ...poison }, 'pipeline', ORIGIN)).toBeNull();
    }
    expect(safeEvaluation({ ...evaluation(), revision: 0 }, 'pipeline')).toBeNull();
  });

  test('requires exact method review and origin request shapes before database use', async () => {
    const { app, pool } = application();
    const badReview = await request(app)
      .post('/api/v1/forecast/demand-to-schedule/method-reviews')
      .set('Idempotency-Key', KEY).send({ purpose: 'seasonal_inbound', action: 'approve',
        expectedRevision: 0, expectedDigest: 'none', reason: 'too short', confirmed: true,
        confirmationVersion: 'm26-demand-schedule-method-review-v1' });
    expect(badReview.status).toBe(400);
    const badOrigin = await request(app)
      .post('/api/v1/forecast/demand-to-schedule/pipeline-origins')
      .set('Idempotency-Key', KEY).send({ horizonDays: 30 });
    expect(badOrigin.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('routes owner capture with server-fixed arguments and idempotent replay', async () => {
    const saved = { ...pipeline({ state: 'pipeline_origin_saved', replayed: true }),
      predictionCutoffAt: CUTOFF, horizonEndsAt: HORIZON };
    const { app, client } = application({ values: {
      canonical_forecast_pipeline_origin_v1_capture: saved,
    } });
    const response = await request(app)
      .post('/api/v1/forecast/demand-to-schedule/pipeline-origins')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send({});
    expect(response.status).toBe(200);
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.data).toEqual(saved);
    const call = client.query.mock.calls.find(([sql]) =>
      sql.includes('canonical_forecast_pipeline_origin_v1_capture'));
    expect(call[1]).toEqual([ORG, USER, 'owner', SESSION, 'csrf', KEY]);
  });

  test('keeps member access and cross-tenant absence non-disclosing', async () => {
    const member = application({ role: 'member' });
    expect((await request(member.app)
      .get(`/api/v1/forecast/demand-to-schedule/pipeline-origins/${ID}`)).status).toBe(403);
    const missing = application({ values: { canonical_forecast_pipeline_origin_v1_read: null } });
    const response = await request(missing.app)
      .get(`/api/v1/forecast/demand-to-schedule/pipeline-origins/${ID}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ state: 'not_found' });
  });

  test('maps guarded contention and database failures without leaking details', async () => {
    const busy = application({ databaseError: { code: '55P03', detail: 'private source lock' } });
    const response = await request(busy.app)
      .get(`/api/v1/forecast/demand-to-schedule/pipeline-origins/${ID}`);
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).not.toContain('private source lock');
    const unavailable = application({ databaseError: { code: 'XX000', detail: 'secret row' } });
    const second = await request(unavailable.app)
      .get(`/api/v1/forecast/demand-to-schedule/pipeline-origins/${ID}`);
    expect(second.status).toBe(503);
    expect(JSON.stringify(second.body)).not.toContain('secret row');
  });

  test('migration fixes target definitions, strict boundaries, bounded receipts and private ACLs', () => {
    const sql = fs.readFileSync('migrations/222_canonical_forecast_demand_to_schedule_v1.sql', 'utf8');
    expect(sql).toContain("'trainingMonths',24");
    expect(sql).toContain("'recordingCloseLagDays',7");
    expect(sql).toContain("'trainingWindowElapsedDays',30");
    expect(sql).toContain("'horizonElapsedDays',30");
    expect(sql).toContain("e.source_occurred_at>starts_at AND e.source_occurred_at<ends_at");
    expect(sql).toContain("event_value.source_occurred_at>saved.prediction_cutoff_at");
    expect(sql).toContain("event_value.source_occurred_at<saved.horizon_ends_at");
    expect(sql).toContain('canonical_forecast_demand_schedule_source_clock_v1_apply');
    expect(sql).toContain("'eligibilityObservedAt'");
    expect(sql).toContain("'acceptedObservedAt'");
    expect(sql).toContain('IF eligible>500 OR octet_length(members::text)>262144');
    expect(sql).toContain('IF historical_eligible+current_eligible>500 OR');
    expect(sql).toContain('IF jsonb_array_length(periods)<>24');
    expect(sql).toContain("IF direction='inconclusive' THEN RETURN");
    expect(sql).toContain("'retellCouplingAvailable',FALSE");
    expect(sql).toContain("'cancellationDoesNotEraseFirstBooking',TRUE");
    expect(sql).toContain('canonical_forecast_demand_schedule_child_key_v1');
    expect(sql).toContain("sha256(convert_to(parent_key||chr(31)||discriminator,'UTF8'))");
    expect(sql).toContain('REVOKE ALL ON TABLE public.canonical_forecast_demand_schedule_epochs_v1');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.canonical_forecast_profile_month_attestation_capture');
  });
});
