'use strict';

const express = require('express');
const querystring = require('node:querystring');
const request = require('supertest');
const { createForecastDemandSourcesRouter } =
  require('../../src/routes/forecastDemandSources');
const { inspectRetellCallWindow } =
  require('../../src/forecasting/retellCallScanReader');
const { getLimitConfig } = require('../../src/middleware/rateLimit');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT = '44444444-4444-4444-8444-444444444444';
const CALL = '55555555-5555-4555-8555-555555555555';
const REVIEW = '66666666-6666-4666-8666-666666666666';
const ORIGIN = '77777777-7777-4777-8777-777777777777';
const EVALUATION = '99999999-9999-4999-8999-999999999999';
const OWNERSHIP = '88888888-8888-4888-8888-888888888888';
const AGENT = 'synthetic-agent';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-demand-source-request-1';
const START = '2026-09-01T00:00:00.000000Z';
const END = '2026-10-01T00:00:00.000000Z';
const CAPTURED = '2026-09-10T12:01:00.000000Z';
const SCANNED = '2026-10-02T12:01:00.000000Z';
const CONSENT_BOUNDARY =
  'Company permission does not establish caller consent, provider coverage or retention.';
const SNAPSHOT_BOUNDARY =
  'Retell call receipts are not distinct reviewed lead identities or complete provider coverage.';
const REVIEW_BOUNDARY =
  'Call dispositions are review evidence, not certified provider coverage or a lead forecast.';
const REVIEWED_BOUNDARY =
  'Reviewed identities only; no caller consent, retention, provider coverage or forecast is certified.';

function consent(action = 'grant') {
  return { id: REVIEW, purposeKey: 'forecast_demand_source', revision: 1,
    previousId: null, action, sourceScope: ['retell.inbound_calls'],
    consentVersion: 'm26-retell-demand-source-consent-v1',
    reason: 'Authorize bounded fictional source review', digest: DIGEST,
    createdAt: '2026-09-10T12:00:00.000Z', boundary: CONSENT_BOUNDARY };
}

function source() {
  return { sourceKind: 'retell_call', sourceId: CALL, revision: 1,
    digest: DIGEST, state: 'active', eventAt: '2026-09-10T12:00:00.000000Z',
    recordedAt: CAPTURED, privateTranscript: 'must not leak' };
}

function snapshot(extra = {}) {
  return { id: SNAPSHOT, version: 'm26-as-of-source-manifest-v1',
    organizationId: ORG, asOf: CAPTURED, capturedAt: CAPTURED,
    purposeKey: 'forecast_demand_source', targetKey: 'retell.inbound_calls',
    sources: [source()], sourceCount: 1, sourceSnapshotDigest: DIGEST,
    sourceConsentId: REVIEW, sourceConsentDigest: DIGEST,
    identityBoundary: SNAPSHOT_BOUNDARY, ...extra };
}

const TRANSITION_TARGETS = ['demand.qualification_transition.v1',
  'demand.estimate_request_transition.v1', 'demand.booking_transition.v1',
  'demand.booking_cancellation.v1'];

function application({ role = 'owner', consentRead, consentWrite, capture,
  snapshotRead, reviews, reviewWrite, readReviewed, databaseError,
  periodEvidence, periodMutation, futureCapture, futureRead, inspectWindow,
  periodSnapshot, periodRead, scanInputs, fetchRetellPage,
  transitionCapture, transitionRead, transitionEvaluationCapture,
  transitionEvaluationRead, transitionMethodWrite, transitionMethodRead } = {}) {
  const app = express();
  // Express's production "simple" parser returns null-prototype objects.
  app.set('query parser', querystring.parse);
  app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER };
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.orgId = ORG;
    req.userRole = role;
    req.authSession = { id: SESSION };
    next();
  };
  const client = { query: jest.fn(async sql => {
    if (databaseError && sql.startsWith('SELECT public.')) throw databaseError;
    if (sql.includes('source_consent_read')) return { rows: [{ value:
      consentRead || { current: null, active: false, history: [], total: 0,
        truncated: false } }] };
    if (sql.includes('source_consent_mutate')) return { rows: [{ value:
      consentWrite || { consent: consent(), replayed: false,
        current: true, active: true } }] };
    if (sql.includes('snapshot_capture')) return { rows: [{ value:
      capture || { snapshot: snapshot(), replayed: false } }] };
    if (sql.includes('snapshot_read')) return { rows: [{ value:
      snapshotRead || snapshot({ stale: false, refreshRequired: false }) }] };
    if (sql.includes('reviews_read')) return { rows: [{ value:
      reviews || { snapshotId: SNAPSHOT, stale: false,
        sourceSnapshotDigest: DIGEST, callCount: 1, reviewedCount: 0,
        unresolvedCount: 1, calls: [{ callSourceId: CALL, status: 'unresolved',
          disposition: null, anchorCallSourceId: null, reviewRevision: 0,
          reviewDigest: null, reviewedAt: null,
          privateTranscript: 'must not leak' }], boundary: REVIEW_BOUNDARY } }] };
    if (sql.includes('review_mutate')) return { rows: [{ value:
      reviewWrite || { id: REVIEW, revision: 1, digest: DIGEST,
        replayed: false, status: 'recorded' } }] };
    if (sql.includes('period_snapshot_v2_capture')) return { rows: [{ value:
      periodSnapshot || { state: 'retell_period_snapshot_saved', replayed: false,
        snapshot: snapshot({ windowVersion: 'm26-retell-period-source-window-v2',
          localMonthStart: '2026-09-01', sourceWindowStartsAt: START,
          sourceWindowEndsAt: END }) } }] };
    if (sql.includes('retell_period_evidence_v2')) return { rows: [{ value:
      periodEvidence || { state: 'retell_period_ready_for_certification',
        organizationId: ORG, snapshotId: SNAPSHOT, localMonthStart: '2026-09-01',
        startsAt: START, endsAt: END, sourceManifestDigest: DIGEST,
        snapshotDigest: DIGEST, integrationOwnershipId: OWNERSHIP,
        agentId: AGENT, providerCallDigestSetDigest: DIGEST,
        sourceCount: 1, reviewedDistinctLeadCount: 1,
        scope: 'retell_only_tenant_all', targetKey: 'demand.inbound_leads',
        targetVersion: 'v1' } }] };
    if (sql.includes('retell_scan_inputs_read')) return { rows: [{ value:
      scanInputs || { state: 'ready_for_diagnostic', agentId: AGENT,
        startsAt: START, endsAt: END, canonicalCallDigests: [DIGEST],
        sourceSnapshotDigest: DIGEST, historicalCoverageCertified: false } }] };
    if (sql.includes('period_certification_v2_mutate')) return { rows: [{ value:
      periodMutation || { state: 'retell_period_certified', id: REVIEW,
        revision: 1, digest: DIGEST, replayed: false } }] };
    if (sql.includes('period_certification_v2_read')) return { rows: [{ value:
      periodRead || { state: 'retell_period_certified', id: REVIEW,
        localMonthStart: '2026-09-01', snapshotId: SNAPSHOT,
        revision: 1, digest: DIGEST, action: 'certify', recordedAt: CAPTURED,
        expectedRevision: 1, expectedDigest: DIGEST,
        callerConsentAttested: true, providerCoverageAttested: true,
        retentionAttested: true, providerIndependentVerified: false,
        wholeBusinessCoverageVerified: false, forecastIssued: false,
        paidNumericServing: false } }] };
    if (sql.includes('future_origin_v2_capture')) return { rows: [{ value:
      futureCapture || { state: 'retell_future_origin_saved', id: ORIGIN,
        asOf: CAPTURED, localHorizonStart: '2026-11-01', evidenceDigest: DIGEST,
        replayed: false, researchOnly: true,
        amountWithheld: true, serviceMixAvailable: false,
        areaForecastAvailable: false, realForecastEligible: false,
        paidNumericServing: false, forecastServingEnabled: false } }] };
    if (sql.includes('future_origin_v2_read')) return { rows: [{ value:
      futureRead || { state: 'retell_future_origin_current', id: ORIGIN,
        asOf: CAPTURED, localHorizonStart: '2026-11-01', startsAt: START,
        horizonStartsAt: START, horizonEndsAt: END,
        targetKey: 'demand.inbound_leads', targetVersion: 'v1',
        scope: 'retell_only_tenant_all', evidenceDigest: DIGEST,
        researchOnly: true, amountWithheld: true,
        serviceMixAvailable: false, areaForecastAvailable: false,
        providerIndependentVerified: false, wholeBusinessCoverageVerified: false,
        paidNumericServing: false, forecastServingEnabled: false } }] };
    if (sql.includes('transition_origin_v2_capture')) return { rows: [{ value:
      transitionCapture || { state: 'transition_origin_saved', id: ORIGIN,
        asOf: CAPTURED, predictionCutoffAt: '2026-11-01T04:00:00.000000Z',
        horizonEndsAt: '2026-12-01T05:00:00.000000Z', targets: TRANSITION_TARGETS,
        sourceCoverageComplete: true,
        sourceCoverageScope: 'post_installation_northstar_selected_sources_only',
        uncertaintyState: 'unavailable_insufficient_natural_calibration',
        replayed: false, researchOnly: true, probabilityWithheld: true,
        outputDigestWithheld: true, realForecastEligible: false,
        forecastIssued: false, paidNumericServing: false,
        forecastServingEnabled: false } }] };
    if (sql.includes('transition_origin_v2_read')) return { rows: [{ value:
      transitionRead || { state: 'transition_origin_current', id: ORIGIN,
        asOf: CAPTURED, predictionCutoffAt: '2026-11-01T04:00:00.000000Z',
        horizonEndsAt: '2026-12-01T05:00:00.000000Z', timeZone: 'America/New_York',
        profileId: SNAPSHOT, methodVersion: 'm26-transition-four-target-research-v2',
        calculationVersion: 'm26-two-complete-local-month-weighted-rate-v2',
        reviewVersion: 'm26-source-finalization-human-review-v2',
        targets: TRANSITION_TARGETS, sourceCoverageComplete: true,
        sourceCoverageScope: 'post_installation_northstar_selected_sources_only',
        uncertaintyState: 'unavailable_insufficient_natural_calibration',
        researchOnly: true, probabilityWithheld: true, outputDigestWithheld: true,
        providerCoverageVerified: false, offPlatformCoverageVerified: false,
        wholeBusinessCoverageVerified: false, naturalProductionHistoryVerified: false,
        empiricalCalibrationVerified: false, empiricalDriftVerified: false,
        realForecastEligible: false, forecastIssued: false,
        paidNumericServing: false, forecastServingEnabled: false } }] };
    if (sql.includes('transition_method_review_v2_mutate')) return { rows: [{ value:
      transitionMethodWrite || { state: 'transition_method_review_recorded', id: REVIEW,
        revision: 1, action: 'approve', reviewDigest: DIGEST, methodId: SNAPSHOT,
        methodDigest: DIGEST, replayed: false, researchOnly: true,
        automaticSelection: false, automaticActionTaken: false,
        paidNumericServing: false, forecastServingEnabled: false } }] };
    if (sql.includes('transition_method_review_v2_read')) return { rows: [{ value:
      transitionMethodRead || { state: 'transition_method_review_current', id: REVIEW,
        revision: 1, action: 'approve', approved: true, reviewDigest: DIGEST,
        methodId: SNAPSHOT, methodDigest: DIGEST,
        methodVersion: 'm26-transition-four-target-research-v2',
        calculationVersion: 'm26-two-complete-local-month-weighted-rate-v2',
        reviewVersion: 'm26-source-finalization-human-review-v2',
        targets: TRANSITION_TARGETS, reviewedAt: CAPTURED, researchOnly: true,
        automaticSelection: false, automaticActionTaken: false,
        paidNumericServing: false, forecastServingEnabled: false } }] };
    if (sql.includes('transition_evaluation_v2_capture')) return { rows: [{ value:
      transitionEvaluationCapture || { state: 'transition_evaluation_saved',
        id: EVALUATION, originId: ORIGIN, revision: 1, replayed: false,
        researchOnly: true, metricsWithheld: true, calibrationClaimed: false,
        driftVerdictIssued: false, automaticActionTaken: false,
        paidNumericServing: false, forecastServingEnabled: false,
        privateMetrics: { actualProbability: '1.000000' } } }] };
    if (sql.includes('transition_evaluation_v2_read')) return { rows: [{ value:
      transitionEvaluationRead || { state: 'transition_evaluation_current',
        id: EVALUATION, originId: ORIGIN, revision: 1, evaluatedAt: CAPTURED,
        researchOnly: true, metricsWithheld: true, calibrationClaimed: false,
        driftVerdictIssued: false, automaticActionTaken: false,
        paidNumericServing: false, forecastServingEnabled: false,
        privateMetrics: { actualProbability: '1.000000' } } }] };
    return { rows: [] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client),
    query: jest.fn((...args) => client.query(...args)) };
  app.use('/sources', createForecastDemandSourcesRouter({ auth,
    throttle: (_req, _res, next) => next(),
    captureThrottle: (_req, _res, next) => next(),
    periodCertificationThrottle: (_req, _res, next) => next(),
    reviewThrottle: (_req, _res, next) => next(),
    poolProvider: () => pool,
    inspectWindow: inspectWindow || jest.fn(async () => ({
      state: 'snapshot_matched', callCount: 1, historicalCoverageCertified: false })),
    fetchRetellPage,
    readReviewed: readReviewed || jest.fn(async () => ({
      state: 'reviewed_source_only', sourceSnapshotDigest: DIGEST,
      callCount: 1, reviewedDistinctLeadCount: 1,
      leadReceipts: [{ organizationId: ORG, leadId: CALL, firstReceiptAt: START,
        reviewedAt: END, sourceDigest: DIGEST, state: 'active' }],
      historicalCoverageCertified: false, boundary: REVIEWED_BOUNDARY,
    })) }));
  return { app, pool, client };
}

const consentBody = { action: 'grant', expectedRevision: 0,
  expectedDigest: 'none', reason: 'Authorize bounded fictional source review',
  confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' };

const reviewBody = { expectedSourceDigest: DIGEST, expectedRevision: 0,
  expectedDigest: 'none', disposition: 'new_lead', anchorCallSourceId: null,
  reason: 'Confirm fictional call as a distinct reviewed lead', confirmed: true,
  confirmationVersion: 'm26-retell-call-review-v1' };

test('owner reads explicit inactive company permission without broader claims', async () => {
  const { app, client } = application();
  const response = await request(app).get('/sources/retell/consent');
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body.data).toEqual({ state: 'company_permission_inactive',
    active: false, current: null, history: [], total: 0, truncated: false,
    callerConsentVerified: false, providerCoverageVerified: false,
    retentionVerified: false, forecastIssued: false });
  expect(client.query.mock.calls[3][1]).toEqual([ORG, USER, 'owner', SESSION]);
});

test('consent reads accept PostgreSQL legal timestamp precision', async () => {
  const historical = { ...consent(), createdAt: '2026-09-10T12:00:00Z' };
  const current = { ...consent('revoke'), id: SNAPSHOT, revision: 2,
    previousId: REVIEW, createdAt: '2026-09-10T12:01:00.12Z' };
  const { app } = application({ consentRead: { current, active: false,
    history: [current, historical], total: 2, truncated: false } });
  const response = await request(app).get('/sources/retell/consent');
  expect(response.status).toBe(200);
  expect(response.body.data.current.createdAt).toBe('2026-09-10T12:01:00.12Z');
  expect(response.body.data.history[1].createdAt).toBe('2026-09-10T12:00:00Z');
});

test('owner grants company permission through serializable guarded mutation', async () => {
  const { app, client } = application();
  const response = await request(app).post('/sources/retell/consent')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send(consentBody);
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ state: 'company_permission_active',
    consentId: REVIEW, action: 'grant', callerConsentVerified: false,
    providerCoverageVerified: false, retentionVerified: false,
    forecastIssued: false });
  expect(client.query.mock.calls.map(call => call[0])).toEqual([
    'BEGIN ISOLATION LEVEL SERIALIZABLE',
    "SET LOCAL statement_timeout = '10000ms'",
    "SET LOCAL lock_timeout = '2000ms'",
    'SELECT public.canonical_forecast_retell_source_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
    'COMMIT',
  ]);
  expect(client.query.mock.calls[3][1].slice(0, 6)).toEqual([
    ORG, USER, 'owner', SESSION, 'validated-csrf', KEY,
  ]);
});

test('snapshot capture returns only bounded source metadata', async () => {
  const { app, client } = application();
  const response = await request(app).post('/sources/retell/snapshots')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf').send({});
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ state: 'retell_call_source_recorded',
    snapshotId: SNAPSHOT, sourceCount: 1, reviewedLeadIdentityVerified: false,
    historicalCoverageVerified: false, forecastIssued: false });
  expect(JSON.stringify(response.body)).not.toMatch(/privateTranscript|sourceId/);
  expect(client.query.mock.calls[3][1]).toEqual([
    ORG, USER, 'owner', SESSION, 'validated-csrf', KEY,
  ]);
});

test('snapshot read exposes only review handles and guarded source digests', async () => {
  const { app, client } = application();
  const response = await request(app).get(`/sources/retell/snapshots/${SNAPSHOT}`);
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ state: 'retell_call_source_current',
    snapshotId: SNAPSHOT, sourceSnapshotDigest: DIGEST,
    sources: [{ callSourceId: CALL, sourceDigest: DIGEST,
      occurredAt: '2026-09-10T12:00:00.000000Z',
      recordedAt: '2026-09-10T12:01:00.000000Z' }],
    refreshRequired: false, reviewedLeadIdentityVerified: false,
    historicalCoverageVerified: false, providerCoverageVerified: false,
    retentionVerified: false, forecastIssued: false });
  expect(JSON.stringify(response.body)).not.toContain('privateTranscript');
  expect(client.query.mock.calls[3][1]).toEqual([ORG, USER, 'owner', SESSION, SNAPSHOT]);
});

test('stale snapshot replay is explicit instead of becoming a server error', async () => {
  const { app } = application({ capture: { snapshot: { id: SNAPSHOT,
    stale: true, refreshRequired: true, sources: [],
    reason: 'private source changed' }, replayed: true } });
  const response = await request(app).post('/sources/retell/snapshots')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf').send({});
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ state: 'source_receipt_stale',
    snapshotId: SNAPSHOT, sourceSnapshotDigest: null, sourceCount: 0,
    replayed: true, forecastIssued: false });
  expect(JSON.stringify(response.body)).not.toContain('private source changed');
});

test('review queue exposes call receipts but never transcript content or coverage', async () => {
  const { app, client } = application();
  const response = await request(app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}/reviews`);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ state: 'call_reviews_incomplete',
    snapshotId: SNAPSHOT, callCount: 1, reviewedCount: 0, unresolvedCount: 1,
    historicalCoverageVerified: false, providerCoverageVerified: false,
    forecastIssued: false });
  expect(response.body.data.calls).toEqual([{ callSourceId: CALL,
    status: 'unresolved', disposition: null, anchorCallSourceId: null,
    reviewRevision: 0, reviewDigest: null }]);
  expect(JSON.stringify(response.body)).not.toContain('privateTranscript');
  expect(client.query.mock.calls[3][1]).toEqual([ORG, USER, 'owner', SESSION, SNAPSHOT]);
});

test('review mutation binds path identity and does not accept caller-supplied transcript IDs', async () => {
  const { app, client } = application();
  const response = await request(app)
    .post(`/sources/retell/snapshots/${SNAPSHOT}/reviews/${CALL}`)
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send(reviewBody);
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ state: 'call_review_recorded',
    reviewId: REVIEW, revision: 1, forecastIssued: false });
  const params = client.query.mock.calls[3][1];
  expect(params.slice(0, 7)).toEqual([
    ORG, USER, 'owner', SESSION, 'validated-csrf', KEY, SNAPSHOT,
  ]);
  expect(JSON.parse(params[7])).toEqual({ transcriptId: CALL,
    expectedSourceDigest: DIGEST, expectedRevision: 0, expectedDigest: 'none',
    disposition: 'new_lead', anchorTranscriptId: null,
    reason: reviewBody.reason, confirmed: true,
    confirmationVersion: 'm26-retell-call-review-v1' });
  expect((await request(app)
    .post(`/sources/retell/snapshots/${SNAPSHOT}/reviews/${CALL}`)
    .set('Idempotency-Key', KEY).send({ ...reviewBody, transcriptId: USER })).status)
    .toBe(400);
});

test('reviewed window is explicit source-only evidence and strips lead identities', async () => {
  const readReviewed = jest.fn(async () => ({ state: 'reviewed_source_only',
    sourceSnapshotDigest: DIGEST, callCount: 2, reviewedDistinctLeadCount: 1,
    leadReceipts: [{ organizationId: ORG, leadId: CALL,
      firstReceiptAt: START, reviewedAt: END, sourceDigest: DIGEST,
      state: 'active' }], historicalCoverageCertified: false,
    boundary: REVIEWED_BOUNDARY }));
  const { app, client } = application({ readReviewed });
  const response = await request(app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}/reviewed-source-window`)
    .query({ startsAt: START, endsAt: END });
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ state: 'reviewed_source_only',
    snapshotId: SNAPSHOT, sourceSnapshotDigest: DIGEST, callCount: 2,
    reviewedDistinctLeadCount: 1, historicalCoverageVerified: false,
    providerCoverageVerified: false, retentionVerified: false,
    forecastIssued: false });
  expect(JSON.stringify(response.body)).not.toMatch(/leadReceipts|leadId/);
  expect(readReviewed).toHaveBeenCalledWith({ pool: client, actor: {
    organizationId: ORG, actorUserId: USER, actorAccessRole: 'owner',
    authSessionId: SESSION }, snapshotId: SNAPSHOT, startsAt: START, endsAt: END });
});

test('member, extra authority, poison and database details fail closed', async () => {
  const member = application({ role: 'member' });
  expect((await request(member.app).get('/sources/retell/consent')).status).toBe(403);
  expect(member.pool.connect).not.toHaveBeenCalled();
  const owner = application();
  expect((await request(owner.app).post('/sources/retell/snapshots')
    .set('Idempotency-Key', KEY).send({ organizationId: ORG })).status).toBe(400);
  expect(owner.pool.connect).not.toHaveBeenCalled();
  const poisoned = application({ reviews: { snapshotId: USER, stale: false,
    calls: [{ privateTranscript: 'do not leak' }] } });
  const response = await request(poisoned.app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}/reviews`);
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain('do not leak');
  expect(poisoned.client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('post endpoints reject query authority and review uses a separate bounded allowance', async () => {
  const { app, pool } = application();
  expect((await request(app).post('/sources/retell/consent?tenant=other')
    .set('Idempotency-Key', KEY).send(consentBody)).status).toBe(400);
  expect((await request(app).post('/sources/retell/snapshots?capture=again')
    .set('Idempotency-Key', KEY).send({})).status).toBe(400);
  expect((await request(app)
    .post(`/sources/retell/snapshots/${SNAPSHOT}/reviews/${CALL}?bulk=true`)
    .set('Idempotency-Key', KEY).send(reviewBody)).status).toBe(400);
  expect(pool.connect).not.toHaveBeenCalled();
  expect(getLimitConfig('forecast-source-review')).toEqual({
    limit: 120, window: 60 * 60 * 1000,
  });
  expect(getLimitConfig('forecast-period-certification')).toEqual({
    limit: 12, window: 60 * 60 * 1000,
  });
  expect(getLimitConfig('forecast-transition-origin')).toEqual({
    limit: 12, window: 60 * 60 * 1000,
  });
});

test('captures an exact month-scoped source receipt without lifetime snapshot dependence', async () => {
  const { app, client } = application();
  const response = await request(app).post('/sources/retell/period-snapshots')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send({ localMonthStart: '2026-09-01' });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ state: 'retell_period_snapshot_saved',
    snapshotId: SNAPSHOT, localMonthStart: '2026-09-01',
    sourceWindowStartsAt: START, sourceWindowEndsAt: END, sourceCount: 1,
    providerCoverageVerified: false, wholeBusinessCoverageVerified: false });
  expect(response.body.data.sources).toEqual([{ callSourceId: CALL,
    sourceDigest: DIGEST, occurredAt: '2026-09-10T12:00:00.000000Z',
    recordedAt: CAPTURED }]);
  expect(client.query.mock.calls.some(call =>
    call[0].includes('period_snapshot_v2_capture'))).toBe(true);
  expect(JSON.stringify(response.body)).not.toContain('privateTranscript');
});

test.each(['source_changed_refresh_required',
  'source_permission_changed_refresh_required'])(
'returns an explicit refresh-required state for a stale month snapshot replay: %s', async reason => {
  const { app } = application({ periodSnapshot: {
    state: 'retell_period_snapshot_unavailable',
    reason, replayed: true,
  } });
  const response = await request(app).post('/sources/retell/period-snapshots')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send({ localMonthStart: '2026-09-01' });
  expect(response.status).toBe(200);
  expect(response.headers['idempotency-replayed']).toBe('true');
  expect(response.body.data).toEqual({
    state: 'retell_period_snapshot_unavailable',
    reason, localMonthStart: '2026-09-01',
    refreshRequired: true, providerCoverageVerified: false,
    wholeBusinessCoverageVerified: false, forecastIssued: false,
  });
});

test('reads the current certification token needed for a later revoke', async () => {
  const { app } = application();
  const response = await request(app)
    .get('/sources/retell/period-certifications/2026-09-01');
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ state: 'retell_period_certified',
    revision: 1, digest: DIGEST, expectedRevision: 1, expectedDigest: DIGEST,
    snapshotId: SNAPSHOT, action: 'certify' });
  expect(JSON.stringify(response.body)).not.toMatch(/providerScan|reviewManifest|sourceManifest/);

  const missing = application({ periodRead: {
    state: 'retell_period_certification_missing', localMonthStart: '2026-09-01',
    expectedRevision: 0, expectedDigest: 'none' } });
  const missingResponse = await request(missing.app)
    .get('/sources/retell/period-certifications/2026-09-01');
  expect(missingResponse.status).toBe(200);
  expect(missingResponse.body.data).toMatchObject({
    state: 'retell_period_certification_missing', expectedRevision: 0,
    expectedDigest: 'none' });
});

test('wrong-tenant and malformed authority projections fail closed', async () => {
  const wrongTenant = application({ snapshotRead: snapshot({
    organizationId: USER, stale: false, refreshRequired: false,
  }) });
  expect((await request(wrongTenant.app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}`)).status).toBe(503);
  const wrongPurpose = application({ capture: { snapshot: snapshot({
    purposeKey: 'another_purpose',
  }), replayed: false } });
  expect((await request(wrongPurpose.app).post('/sources/retell/snapshots')
    .set('Idempotency-Key', KEY).send({})).status).toBe(503);
  const malformedConsent = application({ consentRead: { current: {
    ...consent(), sourceScope: ['other.source'],
  }, active: true, history: [{ ...consent(), sourceScope: ['other.source'] }],
  total: 1, truncated: false } });
  expect((await request(malformedConsent.app)
    .get('/sources/retell/consent')).status).toBe(503);
  const impossibleTime = application({ snapshotRead: snapshot({
    asOf: '2026-99-99T12:01:00.000000Z',
    capturedAt: '2026-99-99T12:01:00.000000Z', stale: false,
    refreshRequired: false,
  }) });
  expect((await request(impossibleTime.app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}`)).status).toBe(503);
  const malformedReviews = application({ reviews: { snapshotId: SNAPSHOT,
    stale: false, sourceSnapshotDigest: 'bad', callCount: 1, reviewedCount: 0,
    unresolvedCount: 1, calls: [{ callSourceId: CALL, status: 'unresolved',
      disposition: null, anchorCallSourceId: null, reviewRevision: 0,
      reviewDigest: null, reviewedAt: null }], boundary: REVIEW_BOUNDARY } });
  expect((await request(malformedReviews.app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}/reviews`)).status).toBe(503);
});

test('reviewed source window rejects wrong-tenant and incoherent helper evidence', async () => {
  const poisoned = application({ readReviewed: jest.fn(async () => ({
    state: 'reviewed_source_only', sourceSnapshotDigest: DIGEST,
    callCount: 1, reviewedDistinctLeadCount: 1,
    leadReceipts: [{ organizationId: USER, leadId: CALL, firstReceiptAt: START,
      reviewedAt: END, sourceDigest: DIGEST, state: 'active' }],
    historicalCoverageCertified: false, boundary: REVIEWED_BOUNDARY,
  })) });
  const wrongTenant = await request(poisoned.app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}/reviewed-source-window`)
    .query({ startsAt: START, endsAt: END });
  expect(wrongTenant.status).toBe(503);
  expect(JSON.stringify(wrongTenant.body)).not.toContain(USER);
  const badCounts = application({ readReviewed: jest.fn(async () => ({
    state: 'reviewed_source_only', sourceSnapshotDigest: DIGEST,
    callCount: 0, reviewedDistinctLeadCount: 1,
    leadReceipts: [{ organizationId: ORG, leadId: CALL, firstReceiptAt: START,
      reviewedAt: END, sourceDigest: DIGEST, state: 'active' }],
    historicalCoverageCertified: false, boundary: REVIEWED_BOUNDARY,
  })) });
  expect((await request(badCounts.app)
    .get(`/sources/retell/snapshots/${SNAPSHOT}/reviewed-source-window`)
    .query({ startsAt: START, endsAt: END })).status).toBe(503);
});

test('database timeout is typed busy, rolled back and never leaks details', async () => {
  const timeout = Object.assign(new Error('private lock details'), { code: '57014' });
  const { app, client } = application({ databaseError: timeout });
  const response = await request(app).get('/sources/retell/consent');
  expect(response.status).toBe(503);
  expect(response.body.error).toEqual({ category: 'FORECAST_DEMAND_SOURCE_BUSY',
    message: 'The demand source is busy. Try again shortly.' });
  expect(JSON.stringify(response.body)).not.toContain('private lock details');
  expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
});

test('owner certifies one exact server-derived Retell period after the bounded scan', async () => {
  const inspectWindow = jest.fn(async () => ({ state: 'snapshot_matched',
    callCount: 1, historicalCoverageCertified: false, agentId: AGENT,
    canonicalCallDigests: [DIGEST], sourceSnapshotDigest: DIGEST,
    scannedAt: SCANNED }));
  const { app, client } = application({ inspectWindow });
  const response = await request(app).post('/sources/retell/period-certifications')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send({ action: 'certify', snapshotId: SNAPSHOT,
      localMonthStart: '2026-09-01', expectedRevision: 0,
      expectedDigest: 'none', callerConsentAttested: true,
      providerCoverageAttested: true, retentionAttested: true,
      reason: 'Confirm complete fictional Retell period evidence', confirmed: true,
      confirmationVersion: 'm26-retell-period-certification-v2' });
  expect(response.status).toBe(201);
  expect(response.body.data).toMatchObject({ state: 'retell_period_certified',
    localMonthStart: '2026-09-01', scope: 'retell_only_tenant_all',
    providerIndependentVerified: false, wholeBusinessCoverageVerified: false,
    forecastIssued: false, paidNumericServing: false });
  expect(inspectWindow).toHaveBeenCalledWith(expect.objectContaining({
    snapshotId: SNAPSHOT, startsAt: START, endsAt: END }));
  const mutation = client.query.mock.calls.find(call =>
    call[0].includes('period_certification_v2_mutate'));
  expect(mutation).toBeDefined();
  expect(mutation[1].slice(11, 15)).toEqual(['0'.repeat(64), 1, '0'.repeat(64),
    expect.stringContaining('m26-retell-provider-scan-v2')]);
  expect(JSON.stringify(response.body)).not.toMatch(/amount|agentId|canonicalCallDigests/);
});

test('real scan reader output passes the route with canonical microsecond scan time', async () => {
  const { app, client } = application({ inspectWindow: inspectRetellCallWindow,
    fetchRetellPage: jest.fn(async () => ({ has_more: false, items: [] })),
    scanInputs: { state: 'ready_for_diagnostic', agentId: AGENT,
      startsAt: START, endsAt: END, canonicalCallDigests: [],
      sourceSnapshotDigest: DIGEST, historicalCoverageCertified: false },
    periodEvidence: { state: 'retell_period_ready_for_certification',
      organizationId: ORG, snapshotId: SNAPSHOT, localMonthStart: '2026-09-01',
      startsAt: START, endsAt: END, sourceManifestDigest: DIGEST,
      snapshotDigest: DIGEST, integrationOwnershipId: OWNERSHIP,
      agentId: AGENT, providerCallDigestSetDigest: DIGEST,
      sourceCount: 0, reviewedDistinctLeadCount: 0,
      scope: 'retell_only_tenant_all', targetKey: 'demand.inbound_leads',
      targetVersion: 'v1' } });
  const response = await request(app).post('/sources/retell/period-certifications')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send({ action: 'certify', snapshotId: SNAPSHOT,
      localMonthStart: '2026-09-01', expectedRevision: 0,
      expectedDigest: 'none', callerConsentAttested: true,
      providerCoverageAttested: true, retentionAttested: true,
      reason: 'Confirm complete fictional Retell period evidence', confirmed: true,
      confirmationVersion: 'm26-retell-period-certification-v2' });
  expect(response.status).toBe(201);
  const mutation = client.query.mock.calls.find(call =>
    call[0].includes('period_certification_v2_mutate'));
  const scanReceipt = JSON.parse(mutation[1][14]);
  expect(scanReceipt.scannedAt).toMatch(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  expect(scanReceipt).toMatchObject({ agentId: AGENT,
    integrationOwnershipId: OWNERSHIP, canonicalCallDigests: [], callCount: 0 });
});

test('period certification refuses provider disagreement without persistence', async () => {
  const { app, client } = application({ inspectWindow: jest.fn(async () => ({
    state: 'unavailable', reason: 'source_records_disagree' })) });
  const response = await request(app).post('/sources/retell/period-certifications')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send({ action: 'certify', snapshotId: SNAPSHOT,
      localMonthStart: '2026-09-01', expectedRevision: 0,
      expectedDigest: 'none', callerConsentAttested: true,
      providerCoverageAttested: true, retentionAttested: true,
      reason: 'Confirm complete fictional Retell period evidence', confirmed: true,
      confirmationVersion: 'm26-retell-period-certification-v2' });
  expect(response.status).toBe(409);
  expect(response.body.error.category)
    .toBe('FORECAST_DEMAND_SOURCE_COVERAGE_UNAVAILABLE');
  expect(client.query.mock.calls.some(call =>
    call[0].includes('period_certification_v2_mutate'))).toBe(false);
});

test('future origin capture and read expose exact lineage while withholding the number', async () => {
  const { app } = application();
  const created = await request(app).post('/sources/retell/future-origins')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf')
    .send({ localHorizonStart: '2026-11-01' });
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ state: 'retell_future_origin_saved',
    id: ORIGIN, scope: 'retell_only_tenant_all', amountWithheld: true,
    serviceMixAvailable: false, areaForecastAvailable: false,
    realForecastEligible: false, paidNumericServing: false,
    forecastServingEnabled: false, forecastIssued: false });
  expect(JSON.stringify(created.body)).not.toMatch(/"amount"|outputDigest/);
  const read = await request(app).get(`/sources/retell/future-origins/${ORIGIN}`);
  expect(read.status).toBe(200);
  expect(read.body.data).toMatchObject({ state: 'retell_future_origin_current',
    amountWithheld: true, providerIndependentVerified: false,
    wholeBusinessCoverageVerified: false, forecastIssued: false });
  expect(JSON.stringify(read.body)).not.toMatch(/"amount"|outputDigest/);
});

test('member and caller-supplied extra future authority fail before database use', async () => {
  const member = application({ role: 'member' });
  expect((await request(member.app).post('/sources/retell/future-origins')
    .set('Idempotency-Key', KEY).send({ localHorizonStart: '2026-11-01' })).status)
    .toBe(403);
  expect(member.pool.connect).not.toHaveBeenCalled();
  const owner = application();
  expect((await request(owner.app).post('/sources/retell/future-origins')
    .set('Idempotency-Key', KEY).send({ localHorizonStart: '2026-11-01',
      amount: '99' })).status).toBe(400);
  expect(owner.pool.connect).not.toHaveBeenCalled();
});

test('four-target transition origin is server-selected and withholds private probability', async () => {
  const { app } = application();
  const created = await request(app).post('/sources/transitions/future-origins')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf').send({});
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ state: 'transition_origin_saved',
    targets: TRANSITION_TARGETS, sourceCoverageComplete: true,
    uncertaintyState: 'unavailable_insufficient_natural_calibration',
    probabilityWithheld: true, outputDigestWithheld: true,
    paidNumericServing: false, forecastServingEnabled: false });
  expect(JSON.stringify(created.body)).not.toMatch(/"probability"|"outputDigest"/);
  const read = await request(app).get(`/sources/transitions/future-origins/${ORIGIN}`);
  expect(read.status).toBe(200);
  expect(read.body.data).toMatchObject({ state: 'transition_origin_current',
    targets: TRANSITION_TARGETS, researchOnly: true, probabilityWithheld: true,
    empiricalCalibrationVerified: false, empiricalDriftVerified: false });
  expect(JSON.stringify(read.body)).not.toMatch(/"probability"|"outputDigest"/);
});

test('human method review is exact, append-only shaped, and remains research-only', async () => {
  const { app, client } = application();
  const body = { action: 'approve', expectedRevision: 0, expectedDigest: 'none',
    reason: 'Approve this exact deterministic four-target research method.',
    confirmed: true, confirmationVersion: 'm26-transition-method-review-v2' };
  const created = await request(app).post('/sources/transitions/method-reviews')
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf').send(body);
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ state: 'transition_method_review_recorded',
    revision: 1, action: 'approve', approved: true, researchOnly: true,
    automaticSelection: false, automaticActionTaken: false,
    paidNumericServing: false, forecastServingEnabled: false });
  expect(client.query.mock.calls[3][1].slice(4)).toEqual([
    'validated-csrf', KEY, 'approve', body.reason, 0, 'none', true,
    'm26-transition-method-review-v2',
  ]);
  const read = await request(app).get('/sources/transitions/method-reviews/current');
  expect(read.status).toBe(200);
  expect(read.body.data).toMatchObject({ state: 'transition_method_review_current',
    revision: 1, action: 'approve', approved: true, targets: TRANSITION_TARGETS,
    automaticSelection: false, automaticActionTaken: false, forecastIssued: false });
});

test('method review rejects member, csrf-shaped extras, and invalid optimistic tokens', async () => {
  const member = application({ role: 'member' });
  expect((await request(member.app).post('/sources/transitions/method-reviews')
    .set('Idempotency-Key', KEY).send({})).status).toBe(403);
  expect(member.pool.connect).not.toHaveBeenCalled();
  const owner = application();
  const valid = { action: 'reject', expectedRevision: 1, expectedDigest: DIGEST,
    reason: 'Reject this reviewed method until the source contract changes.',
    confirmed: true, confirmationVersion: 'm26-transition-method-review-v2' };
  expect((await request(owner.app).post('/sources/transitions/method-reviews')
    .set('Idempotency-Key', KEY).send({ ...valid, probability: '0.5' })).status).toBe(400);
  expect((await request(owner.app).post('/sources/transitions/method-reviews')
    .set('Idempotency-Key', KEY).send({ ...valid, expectedDigest: 'none' })).status).toBe(400);
  expect(owner.pool.connect).not.toHaveBeenCalled();
});

test('current transition origin uses an explicit allowlist against poisoned private fields', async () => {
  const transitionRead = { state: 'transition_origin_current', id: ORIGIN,
    asOf: CAPTURED, predictionCutoffAt: '2026-11-01T04:00:00.000000Z',
    horizonEndsAt: '2026-12-01T05:00:00.000000Z', timeZone: 'America/New_York',
    profileId: SNAPSHOT, methodVersion: 'm26-transition-four-target-research-v2',
    calculationVersion: 'm26-two-complete-local-month-weighted-rate-v2',
    reviewVersion: 'm26-source-finalization-human-review-v2', targets: TRANSITION_TARGETS,
    sourceCoverageComplete: true,
    sourceCoverageScope: 'post_installation_northstar_selected_sources_only',
    uncertaintyState: 'unavailable_insufficient_natural_calibration',
    researchOnly: true, probabilityWithheld: true, outputDigestWithheld: true,
    paidNumericServing: false, forecastServingEnabled: false,
    probability: '0.75', outputDigest: DIGEST,
    privateOutput: { targets: [{ probability: '0.75' }] }, eligibleCount: 999,
    identityFields: { cohortIds: [CALL] } };
  const { app } = application({ transitionRead });
  const response = await request(app).get(`/sources/transitions/future-origins/${ORIGIN}`);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ state: 'transition_origin_current',
    probabilityWithheld: true, outputDigestWithheld: true });
  expect(response.body.data).not.toHaveProperty('profileId');
  expect(response.body.data).not.toHaveProperty('probability');
  expect(response.body.data).not.toHaveProperty('outputDigest');
  expect(response.body.data).not.toHaveProperty('privateOutput');
  expect(response.body.data).not.toHaveProperty('eligibleCount');
  expect(response.body.data).not.toHaveProperty('identityFields');
});

test('transition evaluation withholds metrics and takes no automatic action', async () => {
  const { app } = application();
  const created = await request(app)
    .post(`/sources/transitions/future-origins/${ORIGIN}/evaluations`)
    .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'validated-csrf').send({});
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({ state: 'transition_evaluation_saved',
    metricsWithheld: true, calibrationClaimed: false, driftVerdictIssued: false,
    automaticActionTaken: false });
  expect(JSON.stringify(created.body)).not.toMatch(/absoluteError|actualProbability/);
  const read = await request(app).get(`/sources/transitions/evaluations/${EVALUATION}`);
  expect(read.status).toBe(200);
  expect(read.body.data).toMatchObject({ state: 'transition_evaluation_current',
    metricsWithheld: true, paidNumericServing: false, forecastServingEnabled: false });
});

test('transition routes reject caller authority and member access before database use', async () => {
  const member = application({ role: 'member' });
  expect((await request(member.app).post('/sources/transitions/future-origins')
    .set('Idempotency-Key', KEY).send({})).status).toBe(403);
  expect(member.pool.connect).not.toHaveBeenCalled();
  const owner = application();
  expect((await request(owner.app).post('/sources/transitions/future-origins')
    .set('Idempotency-Key', KEY).send({ probability: '0.5' })).status).toBe(400);
  expect(owner.pool.connect).not.toHaveBeenCalled();
});

test('transition stale and unavailable states remain numeric-free', async () => {
  const stale = application({ transitionRead: { state: 'transition_origin_stale',
    id: ORIGIN, reason: 'source_changed', refreshRequired: true } });
  const response = await request(stale.app)
    .get(`/sources/transitions/future-origins/${ORIGIN}`);
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ state: 'transition_origin_stale',
    refreshRequired: true, sourceCoverageComplete: false,
    paidNumericServing: false });
  expect(JSON.stringify(response.body)).not.toMatch(/"probability":|"outputDigest":/);
});
