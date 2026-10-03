'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const { createForecastConstrainedCapacityRouter, safeOrigin, safeOutcome, safeEvaluation } =
  require('../../src/routes/forecastConstrainedCapacity');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-part5b-test-key-0001';

const common = { allSevenDimensionsApplied: true, resultsWithheld: true,
  outputDigestsWithheld: true, researchOnly: true, forecastIssued: false,
  paidNumericServing: false, forecastServingEnabled: false, automaticActionTaken: false, replayed: false };
function origin(extra = {}) { return { state: 'constrained_capacity_origin_current', id: ID,
  predictionCutoffAt: '2027-01-01T00:00:00.000000Z', horizonEndsAt: '2027-01-31T00:00:00.000000Z',
  scopeCount: 1, refreshRequired: false, ...common, ...extra }; }
function outcome(extra = {}) { return { state: 'constrained_capacity_outcome_current', id: ID,
  originId: OTHER, revision: 1, capturedAt: '2027-01-31T00:00:00.000000Z',
  refreshRequired: false, ...common, ...extra }; }
function evaluation(extra = {}) { const { resultsWithheld, outputDigestsWithheld, ...base } = common;
  return { state: 'constrained_capacity_evaluation_current', id: ID, originId: OTHER,
    outcomeId: '66666666-6666-4666-8666-666666666666', revision: 1,
    capturedAt: '2027-01-31T00:00:00.000000Z', refreshRequired: false,
    metricsWithheld: true, ...base, ...extra }; }

function application({ role = 'owner', values = {}, databaseError } = {}) {
  const app = express(); app.use(express.json());
  const auth = (req, _res, next) => { req.user = { id: USER }; req.orgId = ORG;
    req.tenantContext = { organizationId: ORG, userId: USER }; req.userRole = role;
    req.authSession = { id: SESSION }; next(); };
  const client = { query: jest.fn(async sql => {
    if (databaseError && sql.startsWith('SELECT public.')) throw databaseError;
    if (!sql.startsWith('SELECT public.')) return { rows: [] };
    for (const [needle, value] of Object.entries(values)) if (sql.includes(needle)) return { rows: [{ value }] };
    return { rows: [{ value: null }] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  const bypass = (_req, _res, next) => next();
  app.use('/api/v1/forecast/constrained-capacity', createForecastConstrainedCapacityRouter({
    auth, throttle: bypass, writeThrottle: bypass, poolProvider: () => pool,
  }));
  return { app, client, pool };
}

describe('Mission 26 Part 5B constrained-capacity boundary', () => {
  test('allows exact nonnumeric projections and rejects private, malformed and contradictory results', () => {
    expect(safeOrigin(origin(), ID)).toEqual(origin());
    expect(safeOutcome(outcome(), OTHER, ID)).toEqual(outcome());
    expect(safeEvaluation(evaluation(), OTHER, ID)).toEqual(evaluation());
    for (const poison of [{ personMinutes: 1 }, { privateResults: [] }, { outputDigest: DIGEST },
      { members: [] }, { replayed: 'false' }, { scopeCount: 0 }, { paidNumericServing: true }])
      expect(safeOrigin({ ...origin(), ...poison }, ID)).toBeNull();
    expect(safeOrigin(origin({ horizonEndsAt: '2027-02-01T00:00:00.000000Z' }), ID)).toBeNull();
    expect(safeOutcome(outcome({ originId: ID }), OTHER, ID)).toBeNull();
    expect(safeOutcome(outcome({ privateActuals: [] }), OTHER, ID)).toBeNull();
    expect(safeEvaluation(evaluation({ metrics: {} }), OTHER, ID)).toBeNull();
    expect(safeEvaluation(evaluation({ outcomeId: ID }), OTHER, ID, '66666666-6666-4666-8666-666666666666')).toBeNull();
    expect(safeOrigin(null)).toBeNull();
    expect(safeOutcome(null)).toBeNull();
    expect(safeEvaluation(null)).toBeNull();
    expect(safeOrigin(null, ID, true)).toEqual({ state: 'not_found' });
    expect(safeOutcome(null, OTHER, ID, true)).toEqual({ state: 'not_found' });
    expect(safeEvaluation(null, OTHER, ID, null, true)).toEqual({ state: 'not_found' });
  });

  test('rejects caller clocks, scopes, members, manifests and malformed human decisions before DB use', async () => {
    const { app, pool } = application();
    for (const body of [{ cutoff: '2027-01-01T00:00:00Z' }, { scopeIds: [] }, { members: [] },
      { horizonDays: 30 }, { sourceManifest: {} }]) {
      expect((await request(app).post('/api/v1/forecast/constrained-capacity/origins')
        .set('Idempotency-Key', KEY).send(body)).status).toBe(400);
    }
    const review = { kind: 'scope', scopeKey: 'scope-one', subjectId: null, action: 'approve',
      expectedRevision: 0, expectedDigest: 'none', definition: {}, reason: 'short', confirmed: true,
      confirmationVersion: 'm26-constrained-capacity-review-v1' };
    expect((await request(app).post('/api/v1/forecast/constrained-capacity/reviews')
      .set('Idempotency-Key', KEY).send(review)).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('routes exact origin write and preserves replay identity', async () => {
    const saved = origin({ state: 'constrained_capacity_origin_saved', replayed: true });
    const { app, client } = application({ values: { constrained_capacity_v1_origin_capture: saved } });
    const response = await request(app).post('/api/v1/forecast/constrained-capacity/origins')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send({
        reason: 'Save the complete constrained capacity research origin.', confirmed: true,
        confirmationVersion: 'm26-constrained-capacity-origin-v1' });
    expect(response.status).toBe(200); expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.data).toEqual(saved);
    expect(client.query.mock.calls.find(([sql]) => sql.includes('_origin_capture'))[1]).toEqual([
      ORG, USER, 'owner', SESSION, 'csrf', KEY,
      'Save the complete constrained capacity research origin.', 'm26-constrained-capacity-origin-v1']);
  });

  test('binds exact recovery token identity and withholds review definitions', async () => {
    const value = { state: 'constrained_capacity_review_current', kind: 'scope', scopeKey: 'scope-one',
      subjectId: null, reviewId: ID, action: 'approve', expectedRevision: 2, expectedDigest: DIGEST,
      sourceCurrent: false, researchOnly: true, forecastIssued: false, paidNumericServing: false,
      forecastServingEnabled: false, automaticActionTaken: false };
    const { app } = application({ values: { constrained_capacity_v1_review_current: value } });
    const response = await request(app).get('/api/v1/forecast/constrained-capacity/reviews/current?kind=scope&scopeKey=scope-one&subjectId=none');
    expect(response.status).toBe(200); expect(response.body.data).toEqual(value);
    expect(JSON.stringify(response.body)).not.toMatch(/definition|personMinutes|member|assetCalendar/i);
  });

  test('rejects contradictory prerequisite and review identities at the HTTP boundary', async () => {
    const prerequisite = { state: 'constrained_capacity_prerequisites_current',
      epoch: { state: 'missing', id: ID, revision: null, digest: null, installedAt: null },
      method: { expectedRevision: 0, expectedDigest: 'none', approved: false, sourceCurrent: false },
      scopeCount: 0, jobReviewCount: 0, researchOnly: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false, automaticActionTaken: false };
    const poisoned = application({ values: { constrained_capacity_v1_prerequisites: prerequisite } });
    expect((await request(poisoned.app).get('/api/v1/forecast/constrained-capacity/prerequisites/current')).status)
      .toBe(503);
    expect((await request(poisoned.app).get(
      `/api/v1/forecast/constrained-capacity/reviews/current?kind=method&scopeKey=scope-one&subjectId=none`)).status)
      .toBe(400);
    expect((await request(poisoned.app).post('/api/v1/forecast/constrained-capacity/reviews')
      .set('Idempotency-Key', KEY).send({ kind: 'scope', scopeKey: 'scope-one', subjectId: null,
        action: 'approve', expectedRevision: 0, expectedDigest: DIGEST, definition: {},
        reason: 'Reject a mismatched recovery token before database use.', confirmed: true,
        confirmationVersion: 'm26-constrained-capacity-review-v1' })).status).toBe(400);
  });

  test('keeps missing and cross-role receipt identities non-disclosing', async () => {
    const missing = application({ values: { constrained_capacity_v1_origin_read: null } });
    expect((await request(missing.app).get(`/api/v1/forecast/constrained-capacity/origins/${ID}`)).body.data)
      .toEqual({ state: 'not_found' });
    expect((await request(application({ role: 'member' }).app)
      .get(`/api/v1/forecast/constrained-capacity/origins/${ID}`)).status).toBe(403);
  });

  test('maps guarded failures without leaking database details', async () => {
    const response = await request(application({ databaseError: { code: 'XX000', detail: 'private 99.5' } }).app)
      .get(`/api/v1/forecast/constrained-capacity/origins/${ID}`);
    expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('99.5');
  });

  test('migration fixes exact target, elapsed horizon, seven dimensions and private grants', () => {
    const sql = fs.readFileSync('migrations/225_canonical_forecast_constrained_capacity_v1.sql', 'utf8');
    expect(sql).toContain("'capacity.available_role_hours.v1'");
    expect(sql).toContain("CHECK(horizon_ends_at=prediction_cutoff_at+INTERVAL '2592000 seconds')");
    expect(sql).toContain("INTERVAL '2592000 seconds'");
    for (const dimension of ['crew','skill','workingHours','location','travel','vehicle','equipment'])
      expect(sql).toContain(`'${dimension}'`);
    expect(sql).toContain('Constrained-capacity scopes share people or assets');
    expect(sql).toContain('Complete approved work constraint census unavailable');
    expect(sql).toContain('Exact declared asset horizon unavailable');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.canonical_forecast_constrained_capacity_v1_source_capture()');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.canonical_forecast_constrained_capacity_v1_prerequisites');
  });
});
