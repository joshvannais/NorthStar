'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const { createForecastCapacityAdvisoryRouter, safeOrigin, safeOutcome, safeEvaluation, safeCategories } =
  require('../../src/routes/forecastCapacityAdvisory');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-part5c-test-key-0001';
const flags = { researchOnly: true, forecastIssued: false, paidNumericServing: false,
  forecastServingEnabled: false, automaticActionTaken: false, replayed: false };
const categoryStates = { bottleneck: { state: 'attention' }, backlog: { state: 'attention' },
  overtime: { state: 'clear' }, contractor: { state: 'clear' }, hiring_need: { state: 'insufficient_history' } };
const categories = [{ alternativeKey: 'baseline', scopeKey: 'technician', role: 'technician', categories: categoryStates }];
const origin = (extra = {}) => ({ state: 'capacity_advisory_origin_current', id: ID,
  predictionCutoffAt: '2027-01-01T00:00:00.000000Z', horizonEndsAt: '2027-01-31T00:00:00.000000Z',
  scopeCount: 1, categoryCount: 5, decisionAction: 'approve', categories, refreshRequired: false,
  valuesWithheld: true, thresholdsWithheld: true, outputDigestsWithheld: true, ...flags, ...extra });
const outcome = (extra = {}) => ({ state: 'capacity_advisory_outcome_current', id: ID, originId: OTHER,
  revision: 1, capturedAt: '2027-01-31T00:00:00.000000Z', refreshRequired: false,
  valuesWithheld: true, outputDigestsWithheld: true, ...flags, ...extra });
const evaluation = (extra = {}) => ({ state: 'capacity_advisory_evaluation_current', id: ID, originId: OTHER,
  outcomeId: '66666666-6666-4666-8666-666666666666', decisionId: '77777777-7777-4777-8777-777777777777',
  revision: 1, evaluatedAt: '2027-01-31T00:00:00.000000Z', refreshRequired: false,
  metricsWithheld: true, ...flags, ...extra });

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
  const pool = { connect: jest.fn(async () => client) }; const bypass = (_req, _res, next) => next();
  app.use('/api/v1/forecast/capacity-advice', createForecastCapacityAdvisoryRouter({
    auth, throttle: bypass, writeThrottle: bypass, poolProvider: () => pool,
  }));
  return { app, client, pool };
}

describe('Mission 26 Part 5C qualitative capacity-advisory boundary', () => {
  test('accepts exact qualitative receipts and rejects semantic and private poison', () => {
    expect(safeCategories(categories)).toBe(true);
    expect(safeOrigin(origin(), ID)).toEqual(origin());
    expect(safeOutcome(outcome(), OTHER, ID)).toEqual(outcome());
    expect(safeEvaluation(evaluation(), OTHER, ID, evaluation().outcomeId)).toEqual(evaluation());
    expect(safeCategories([{ ...categories[0], categories: { ...categoryStates,
      backlog: { state: 'insufficient_history' } } }])).toBe(false);
    for (const poison of [{ demandMinutes: 1 }, { threshold: 2 }, { outputDigest: DIGEST },
      { privateResults: [] }, { members: [] }, { replayed: 'false' }, { categoryCount: 4 }])
      expect(safeOrigin({ ...origin(), ...poison }, ID)).toBeNull();
    expect(safeOrigin(origin({ categories: [{ ...categories[0], unexpected: true }] }), ID)).toBeNull();
    expect(safeOutcome(outcome({ privateActuals: [] }), OTHER, ID)).toBeNull();
    expect(safeEvaluation(evaluation({ metrics: {} }), OTHER, ID)).toBeNull();
  });

  test('rejects caller clocks, horizons, sources and downstream action inputs before DB use', async () => {
    const { app, pool } = application();
    for (const body of [{ cutoff: '2027-01-01T00:00:00Z' }, { horizonDays: 30 }, { scopeIds: [] },
      { members: [] }, { sourceManifest: {} }, { createSchedule: true }, { hire: true }])
      expect((await request(app).post('/api/v1/forecast/capacity-advice/origins')
        .set('Idempotency-Key', KEY).send(body)).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('binds write identity, exact replay boolean and guarded request body', async () => {
    const saved = origin({ state: 'capacity_advisory_origin_saved', decisionAction: null, categories: null, replayed: true });
    const { app, client } = application({ values: { capacity_advisory_v1_origin_capture: saved } });
    const response = await request(app).post('/api/v1/forecast/capacity-advice/origins')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send({
        reason: 'Save the complete private qualitative advisory origin.', confirmed: true,
        confirmationVersion: 'm26-capacity-advisory-origin-v1' });
    expect(response.status).toBe(200); expect(response.headers['idempotency-replayed']).toBe('true');
    expect(client.query.mock.calls.find(([sql]) => sql.includes('_origin_capture'))[1]).toEqual([
      ORG, USER, 'owner', SESSION, 'csrf', KEY,
      'Save the complete private qualitative advisory origin.', 'm26-capacity-advisory-origin-v1']);
    for (const replayed of ['true', null, undefined]) {
      const malformed = { ...saved }; if (replayed === undefined) delete malformed.replayed; else malformed.replayed = replayed;
      expect((await request(application({ values: { capacity_advisory_v1_origin_capture: malformed } }).app)
        .post('/api/v1/forecast/capacity-advice/origins').set('X-CSRF-Token', 'csrf')
        .set('Idempotency-Key', KEY).send({ reason: 'Save the complete private qualitative advisory origin.',
          confirmed: true, confirmationVersion: 'm26-capacity-advisory-origin-v1' })).status).toBe(503);
    }
  });

  test('enforces exact state and replay contracts on every receipt write and read', async () => {
    const reviewBody = { kind: 'method', alternativeKey: null, scopeKey: null, role: null, subjectId: null,
      action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      definition: { methodVersion: 'm26-capacity-advisory-five-category-v1' },
      reason: 'Approve the exact qualitative capacity advisory method.', confirmed: true,
      confirmationVersion: 'm26-capacity-advisory-review-v1' };
    const review = { state: 'capacity_advisory_review_recorded', id: ID, kind: 'method', alternativeKey: null,
      scopeKey: null, role: null, subjectId: null, action: 'approve', revision: 1, digest: DIGEST, replayed: false };
    const epoch = { state: 'capacity_advisory_epoch_recorded', id: ID, revision: 1,
      installedAt: '2027-01-01T00:00:00Z', digest: DIGEST, replayed: false };
    const decisionBody = { action: 'approve', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Approve this exact qualitative advisory receipt.', confirmed: true,
      confirmationVersion: 'm26-capacity-advisory-decision-v1' };
    const decision = { state: 'capacity_advisory_decision_recorded', id: ID, originId: OTHER,
      action: 'approve', revision: 1, digest: DIGEST, replayed: false };
    const preparation = { state: 'capacity_advisory_outcome_basis_ready', originId: OTHER,
      workloadEvaluationId: ID, alternativeKeys: ['baseline'], periodStart: '2027-01-01T00:00:00Z',
      periodEnd: '2027-01-31T00:00:00Z', researchOnly: true, valuesWithheld: true,
      automaticActionTaken: false, replayed: false };
    const writes = [
      ['/reviews', reviewBody, 'capacity_advisory_v1_review_mutate', review],
      ['/epochs', { reason: 'Install the exact qualitative advisory coverage epoch.', confirmed: true,
        confirmationVersion: 'm26-capacity-advisory-epoch-v1' }, 'capacity_advisory_v1_epoch_capture', epoch],
      [`/origins/${OTHER}/decisions`, decisionBody, 'capacity_advisory_v1_decision_mutate', decision],
      [`/origins/${OTHER}/outcome-preparations`, {}, 'capacity_advisory_v1_outcome_prepare', preparation],
      [`/origins/${OTHER}/outcomes`, {}, 'capacity_advisory_v1_outcome_capture',
        outcome({ state: 'capacity_advisory_outcome_saved', originId: OTHER })],
      [`/origins/${OTHER}/evaluations`, { outcomeId: ID }, 'capacity_advisory_v1_evaluation_capture',
        evaluation({ state: 'capacity_advisory_evaluation_saved', originId: OTHER, outcomeId: ID })],
    ];
    for (const [path, body, entry, valid] of writes) {
      for (const replayed of [false, true]) {
        const response = await request(application({ values: { [entry]: { ...valid, replayed } } }).app)
          .post('/api/v1/forecast/capacity-advice' + path).set('X-CSRF-Token', 'csrf')
          .set('Idempotency-Key', KEY).send(body);
        expect([200, 201]).toContain(response.status);
      }
      for (const replayed of ['false', null]) {
        const response = await request(application({ values: { [entry]: { ...valid, replayed } } }).app)
          .post('/api/v1/forecast/capacity-advice' + path).set('X-CSRF-Token', 'csrf')
          .set('Idempotency-Key', KEY).send(body);
        expect(response.status).toBe(503);
      }
    }

    const reads = [
      [`/origins/${ID}`, 'capacity_advisory_v1_origin_read', origin()],
      [`/origins/${OTHER}/outcomes/${ID}`, 'capacity_advisory_v1_outcome_read', outcome()],
      [`/origins/${OTHER}/evaluations/${ID}`, 'capacity_advisory_v1_evaluation_read', evaluation()],
    ];
    for (const [path, entry, valid] of reads) {
      expect((await request(application({ values: { [entry]: valid } }).app)
        .get('/api/v1/forecast/capacity-advice' + path)).status).toBe(200);
      for (const poison of [{ ...valid, replayed: true }, { ...valid, state: valid.state.replace('_current', '_saved') }])
        expect((await request(application({ values: { [entry]: poison } }).app)
          .get('/api/v1/forecast/capacity-advice' + path)).status).toBe(503);
    }
  });

  test('requires exact prerequisite and nested receipt identities', async () => {
    const prerequisite = { state: 'capacity_advisory_prerequisites_current',
      epoch: { state: 'missing', id: null, revision: null, installedAt: null },
      method: { expectedRevision: 0, expectedDigest: 'none', approved: false, sourceCurrent: false },
      policyCount: 0, scopeCount: 0,
      categories: ['bottleneck', 'backlog', 'overtime', 'contractor', 'hiring_need'],
      researchOnly: true, forecastIssued: false, paidNumericServing: false,
      forecastServingEnabled: false, automaticActionTaken: false };
    expect((await request(application({ values: { capacity_advisory_v1_prerequisites: prerequisite } }).app)
      .get('/api/v1/forecast/capacity-advice/prerequisites/current')).status).toBe(200);
    expect((await request(application({ values: { capacity_advisory_v1_prerequisites:
      { ...prerequisite, epoch: { state: 'current', id: null, revision: null, installedAt: null } } } }).app)
      .get('/api/v1/forecast/capacity-advice/prerequisites/current')).status).toBe(503);
    const notFound = { code: 'P0002' };
    expect((await request(application({ databaseError: notFound }).app)
      .get(`/api/v1/forecast/capacity-advice/origins/${OTHER}/outcomes/${ID}`)).status).toBe(404);
    expect((await request(application({ databaseError: notFound }).app)
      .get(`/api/v1/forecast/capacity-advice/origins/${OTHER}/evaluations/${ID}`)).status).toBe(404);
  });

  test('validates current review and decision projections without private or replay poison', async () => {
    const currentReview = { state: 'capacity_advisory_review_current', kind: 'method', alternativeKey: null,
      scopeKey: null, role: null, subjectId: null, reviewId: ID, action: 'approve', expectedRevision: 1,
      expectedDigest: DIGEST, sourceCurrent: true, researchOnly: true, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false, automaticActionTaken: false };
    const query = '?kind=method&alternativeKey=none&scopeKey=none&role=none&subjectId=none';
    expect((await request(application({ values: { capacity_advisory_v1_review_current: currentReview } }).app)
      .get('/api/v1/forecast/capacity-advice/reviews/current' + query)).status).toBe(200);
    for (const poison of [{ ...currentReview, privateDefinition: {} },
      { ...currentReview, expectedRevision: 0 }, { ...currentReview, sourceCurrent: 'true' }])
      expect((await request(application({ values: { capacity_advisory_v1_review_current: poison } }).app)
        .get('/api/v1/forecast/capacity-advice/reviews/current' + query)).status).toBe(503);

    const currentDecision = { state: 'capacity_advisory_decision_current', id: ID, originId: OTHER,
      action: 'approve', revision: 1, refreshRequired: false, researchOnly: true,
      automaticActionTaken: false, replayed: false };
    const decisionPath = `/api/v1/forecast/capacity-advice/origins/${OTHER}/decisions/${ID}`;
    expect((await request(application({ values: { capacity_advisory_v1_decision_read: currentDecision } }).app)
      .get(decisionPath)).status).toBe(200);
    for (const poison of [{ ...currentDecision, replayed: true }, { ...currentDecision, privateResults: [] },
      { ...currentDecision, originId: ID }])
      expect((await request(application({ values: { capacity_advisory_v1_decision_read: poison } }).app)
        .get(decisionPath)).status).toBe(503);
  });

  test('keeps member access and database details non-disclosing', async () => {
    expect((await request(application({ role: 'member' }).app)
      .get(`/api/v1/forecast/capacity-advice/origins/${ID}`)).status).toBe(403);
    const response = await request(application({ databaseError: { code: 'XX000', detail: 'private 6000' } }).app)
      .get(`/api/v1/forecast/capacity-advice/origins/${ID}`);
    expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('6000');
  });

  test('migration fixes five qualitative categories, exact upstream composition and no action authority', () => {
    const sql = fs.readFileSync('migrations/226_canonical_forecast_capacity_advisory_v1.sql', 'utf8');
    for (const category of ['bottleneck', 'backlog', 'overtime', 'contractor', 'hiring_need'])
      expect(sql).toContain(`'${category}'`);
    expect(sql).toContain('canonical_forecast_workload_capacity_v1_origin_capture');
    expect(sql).toContain('canonical_forecast_constrained_capacity_v1_complete_input');
    expect(sql).toContain("'scopeApplicability'");
    expect(sql).toContain("'automaticActionTaken',FALSE");
    expect(sql).toContain('REVOKE ALL ON TABLE public.canonical_forecast_capacity_advisory_methods_v1');
    expect(sql).not.toMatch(/INSERT INTO public\.(?:canonical_schedule|workforce_memberships|canonical_estimates)/);
  });
});
