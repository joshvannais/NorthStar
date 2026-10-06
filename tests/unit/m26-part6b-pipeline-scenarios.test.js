'use strict';

const express = require('express');
const request = require('supertest');
const {
  createForecastPipelineScenariosRouter,
  safePolicy,
  safeOrigin,
  safeEvaluation,
} = require('../../src/routes/forecastPipelineScenarios');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const ORIGIN = '55555555-5555-4555-8555-555555555555';
const START = '2026-11-01T04:00:00.000000Z';
const END = '2026-12-01T05:00:00.000000Z';

const policy = (write = false) => ({
  state: write ? 'pipeline_scenario_policy_reviewed' : 'pipeline_scenario_policy_current',
  id: ID,
  revision: 1,
  action: 'approve',
  ...(write ? { replayed: false } : {}),
  weightsWithheld: true,
  weightsAreScenarioAssumptions: true,
  probabilityCalibrated: false,
  forecastIssued: false,
});
const origin = (write = false) => ({
  state: write ? 'pipeline_scenario_origin_saved' : 'pipeline_scenario_origin_current',
  id: ORIGIN,
  horizonStartsAt: START,
  horizonEndsAt: END,
  ...(write ? { replayed: false } : {
    captureInputsCurrentAtRead: true,
    captureInputsFrozen: false,
  }),
  targetKey: 'pipeline.open_value_scenario',
  targetVersion: 'v1',
  evaluationMeasurementKey: 'research.pipeline_cutoff_cohort_booked_work_value',
  formalBookedWorkValueTargetClaimed: false,
  postCutoffEntrantsExcluded: true,
  valuesWithheld: true,
  ...(!write ? { sourceCoverageCompleteAtCapture: true } : {}),
  weightsAreScenarioAssumptions: true,
  probabilityCalibrated: false,
  researchOnly: true,
  realForecastEligible: false,
  forecastIssued: false,
  paidNumericServing: false,
  automaticActionAuthorized: false,
});
const evaluation = (write = false) => ({
  state: write ? 'pipeline_scenario_evaluation_saved' :
    'pipeline_scenario_evaluation_current',
  id: ID,
  originId: ORIGIN,
  revision: 1,
  ...(write ? { replayed: false } : { evaluatedAt: '2026-12-02T00:00:00.000000Z' }),
  measurementKey: 'research.pipeline_cutoff_cohort_booked_work_value',
  formalTargetClaimed: false,
  postCutoffEntrantsExcluded: true,
  metricsWithheld: true,
  researchOnly: true,
  calibrationClaimed: false,
  forecastIssued: false,
  paidNumericServing: false,
  automaticActionTaken: false,
});

function application(value) {
  const app = express();
  app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER };
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.orgId = ORG;
    req.userRole = 'owner';
    req.authSession = { id: SESSION };
    next();
  };
  const client = {
    query: jest.fn(async sql => sql.startsWith('SELECT public.') ?
      { rows: [{ value }] } : { rows: [] }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client) };
  app.use('/pipeline', createForecastPipelineScenariosRouter({
    auth,
    throttle: (_req, _res, next) => next(),
    poolProvider: () => pool,
  }));
  return { app, pool, client };
}

test('runtime sanitizers expose lifecycle metadata only', () => {
  expect(safePolicy(policy(true), 'write')).toEqual(policy(true));
  expect(safePolicy(policy(false), 'read')).toEqual(policy(false));
  expect(safeOrigin(origin(true), 'write')).toEqual(origin(true));
  expect(safeOrigin(origin(false), 'read', ORIGIN)).toEqual(origin(false));
  expect(safeEvaluation(evaluation(true), 'write', ORIGIN)).toEqual(evaluation(true));
  expect(safeEvaluation(evaluation(false), 'read', ORIGIN, ID)).toEqual(evaluation(false));
});

test.each([
  ['scenarioWeights', { lower: 1, central: 2, upper: 3 }],
  ['lower', 1], ['central', 2], ['upper', 3], ['price', '50.00'],
  ['count', 1], ['member', { id: ID }], ['members', []], ['manifest', []],
  ['digest', 'a'.repeat(64)], ['privateOutput', {}], ['actual', 1],
  ['error', 1], ['metrics', {}],
])('poison field %s invalidates every matching lifecycle receipt', (name, value) => {
  expect(safePolicy({ ...policy(false), [name]: value }, 'read')).toBeNull();
  expect(safeOrigin({ ...origin(false), [name]: value }, 'read', ORIGIN)).toBeNull();
  expect(safeEvaluation({ ...evaluation(false), [name]: value }, 'read', ORIGIN, ID))
    .toBeNull();
});

test('HTTP poison becomes a generic 503 and never reaches the response', async () => {
  const poison = { ...policy(false), scenarioWeights: { hidden: 500000 } };
  const { app } = application(poison);
  const response = await request(app).get('/pipeline/policies/current');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ success: false,
    error: 'Pipeline scenario research unavailable' });
  expect(JSON.stringify(response.body)).not.toContain('500000');
  expect(JSON.stringify(response.body)).not.toContain('scenarioWeights');
});

test('frozen-origin unavailability is an exact withheld evaluation result', async () => {
  const unavailable = {
    state: 'pipeline_scenario_evaluation_unavailable',
    reason: 'frozen_origin_evidence_unavailable',
    metricsWithheld: true,
    researchOnly: true,
    forecastIssued: false,
    paidNumericServing: false,
  };
  expect(safeEvaluation(unavailable, 'write', ORIGIN)).toEqual(unavailable);
  const { app } = application(unavailable);
  const response = await request(app)
    .post(`/pipeline/origins/${ORIGIN}/evaluations`)
    .set('Idempotency-Key', 'pipeline-evaluation-request-0001')
    .send({ reason: 'Evaluate the exact frozen pipeline scenario cohort.',
      confirmed: true,
      confirmationVersion: 'pipeline-cutoff-cohort-evaluation-v1' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ success: true, data: unavailable });
});

test('origin input cannot submit cohort, weights, cutoff, horizon, or actuals', async () => {
  for (const poison of [
    { scenarioWeights: {} }, { members: [] }, { prices: [] }, { cutoffAt: START },
    { horizonStartsAt: START }, { count: 1 }, { digest: 'a'.repeat(64) },
    { actualBookedWorkValueMicro: 1 },
  ]) {
    const { app, pool } = application(origin(true));
    const response = await request(app).post('/pipeline/origins')
      .set('Idempotency-Key', 'pipeline-origin-request-0001')
      .send({ reason: 'Capture the bounded private research cohort', confirmed: true,
        confirmationVersion: 'pipeline-open-value-scenario-v1', ...poison });
    expect(response.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  }
});

test('policy write passes only reviewed scenario assumptions and no expected digest', async () => {
  const { app, client } = application(policy(true));
  const response = await request(app).post('/pipeline/policies')
    .set('Idempotency-Key', 'pipeline-policy-request-0001')
    .send({ action: 'approve', reason: 'Approve private bounded scenario assumptions',
      expectedRevision: 0,
      scenarioWeights: {
        preliminaryEstimate: { lowerPpm: 100000, centralPpm: 250000, upperPpm: 500000 },
        approvedUnbooked: { lowerPpm: 500000, centralPpm: 750000, upperPpm: 900000 },
      },
      confirmed: true, confirmationVersion: 'pipeline-scenario-policy-v1' });
  expect(response.status).toBe(201);
  expect(response.body.data).toEqual(policy(true));
  const call = client.query.mock.calls.find(([sql]) => sql.includes('policy_mutate'));
  expect(call[0]).toContain('$17');
  expect(call[1]).toEqual([ORG, USER, 'owner', SESSION, undefined,
    'pipeline-policy-request-0001', 'approve',
    'Approve private bounded scenario assumptions', 0,
    100000, 250000, 500000, 500000, 750000, 900000, true,
    'pipeline-scenario-policy-v1']);
});

test('read responses are private no-store and bind the requested identity', async () => {
  const { app } = application(origin(false));
  const response = await request(app).get(`/pipeline/origins/${ORIGIN}`);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.body.data.id).toBe(ORIGIN);
});
