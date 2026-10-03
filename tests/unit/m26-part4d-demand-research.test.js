'use strict';

const fs = require('node:fs');
const research = require('../../public/js/command-center-demand-research');

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);
const INSTANT = '2026-10-03T12:00:00.000000Z';
const TRANSITION_TARGETS = ['demand.qualification_transition.v1',
  'demand.estimate_request_transition.v1', 'demand.booking_transition.v1',
  'demand.booking_cancellation.v1'];

class Element {
  constructor() { this.textContent = ''; this.value = ''; this.hidden = false;
    this.disabled = false; this.children = []; this.listeners = {}; this.dataset = {}; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  replaceChildren() { this.children = []; }
  append(...items) { this.children.push(...items); }
}
function fixture() {
  const ids = ['commandCenterResearchRoot', 'commandCenterResearchActions', 'commandCenterResearchRetry',
    'commandCenterResearchDemoAction', 'commandCenterResearchDemoReset',
    'commandCenterResearchPaid', 'commandCenterResearchDemo', 'commandCenterResearchHorizon',
    'commandCenterResearchCertificationMonth', 'commandCenterResearchPeriodSnapshotId',
    'commandCenterResearchProfileAnchorId', 'commandCenterResearchRetellSnapshotId',
    'commandCenterResearchRetellCallSourceId', 'commandCenterResearchRetellAnchorCallId',
    'commandCenterResearchRetellDisposition',
    'commandCenterResearchDecisionReason', 'commandCenterDemandState',
    'commandCenterDemandExplanation', 'commandCenterDemandBoundary'];
  for (const slot of ['Inbound', 'Transitions', 'Seasonal', 'Pipeline', 'Setup'])
    ids.push('commandCenterResearch' + slot);
  for (const name of ['Retell', 'Transition', 'TransitionEvaluation', 'Seasonal',
    'SeasonalEvaluation', 'Pipeline', 'PipelineEvaluation']) ids.push('commandCenterResearch' + name + 'Id');
  const values = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { values, document: { getElementById: id => values[id] || null,
    createElement: () => new Element() } };
}
function response(status, data, error) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => status >= 200 && status < 300 ? { success: true, data } :
      { success: false, error } };
}
function flags() { return { researchOnly: true, forecastIssued: false,
  paidNumericServing: false, forecastServingEnabled: false }; }
function pipeline(extra = {}) { return { state: 'pipeline_origin_saved', id: ID,
  predictionCutoffAt: INSTANT, horizonEndsAt: '2026-11-02T12:00:00.000000Z',
  countWithheld: true, outputDigestWithheld: true, replayed: false, ...flags(), ...extra }; }
function seasonal(extra = {}) { return { state: 'seasonal_origin_saved', id: ID,
  localHorizonStart: '2026-11-01', amountWithheld: true,
  outputDigestWithheld: true, seasonalSignalState: 'repeated_high',
  replayed: false, ...flags(), ...extra }; }
function prerequisites(extra = {}) {
  const item = (purpose, target) => ({ purpose, targetKey: target, targetVersion: 'v1',
    calculationVersion: purpose === 'seasonal_inbound' ?
      'm26-seasonal-two-cycle-open-minute-v1' : 'm26-pipeline-first-booking-pooled-v1',
    method: { expectedRevision: 0,
      expectedDigest: 'none', action: null, approved: false },
    epoch: { state: 'missing', id: null, revision: null, installedAt: null } });
  return { state: 'demand_ui_prerequisites_current',
    profile: { state: 'current', anchorId: ID },
    seasonal: item('seasonal_inbound', 'demand.inbound_leads'),
    pipeline: item('pipeline_first_booking', 'demand.pipeline_first_accepted_bookings'),
    researchOnly: true, automaticActionTaken: false, forecastIssued: false,
    paidNumericServing: false, forecastServingEnabled: false, ...extra };
}
function transitionReviewCurrent(extra = {}) {
  return { state: 'transition_method_review_current', id: ID, revision: 1,
    action: 'approve', approved: true, reviewDigest: DIGEST, methodId: OTHER,
    methodDigest: DIGEST, methodVersion: 'm26-transition-four-target-research-v2',
    calculationVersion: 'm26-two-complete-local-month-weighted-rate-v2',
    reviewVersion: 'm26-source-finalization-human-review-v2', targets: TRANSITION_TARGETS,
    reviewedAt: INSTANT, researchOnly: true, automaticSelection: false,
    automaticActionTaken: false, forecastIssued: false, paidNumericServing: false,
    forecastServingEnabled: false, ...extra };
}
function transitionReviewRecorded(replayed) {
  const value = { state: 'transition_method_review_recorded', id: ID, revision: 2,
    action: 'approve', reviewDigest: DIGEST, methodId: OTHER, methodDigest: DIGEST,
    approved: true, researchOnly: true, automaticSelection: false,
    automaticActionTaken: false, forecastIssued: false, paidNumericServing: false,
    forecastServingEnabled: false };
  if (replayed !== undefined) value.replayed = replayed;
  return value;
}

describe('Mission 26 Part 4D guarded demand research presentation', () => {
  test('accepts exact safe projections and refuses private or conflicting shapes', () => {
    expect(research.validateDemandOrigin(pipeline(), 'pipeline')).not.toBeNull();
    expect(research.validateDemandOrigin(seasonal(), 'seasonal')).not.toBeNull();
    expect(research.validateDemandOrigin({ ...pipeline(), expectedCount: '2' }, 'pipeline')).toBeNull();
    expect(research.validateDemandOrigin({ ...pipeline(), id: OTHER }, 'pipeline', ID)).toBeNull();
    expect(research.validateDemandEvaluation({ state: 'pipeline_evaluation_saved', id: ID,
      originId: OTHER, revision: 1, replayed: false, metricsWithheld: true, ...flags() },
    'pipeline', OTHER)).not.toBeNull();
    expect(research.validateDemandEvaluation({ state: 'pipeline_evaluation_saved', id: ID,
      originId: OTHER, revision: 1, replayed: false, metricsWithheld: true,
      privateMetrics: { error: 2 }, ...flags() }, 'pipeline', OTHER)).toBeNull();
    expect(research.validateDemandEvaluation({ state: 'pipeline_evaluation_current', id: ID,
      originId: OTHER, revision: 1, evaluatedAt: INSTANT, metricsWithheld: true, ...flags() },
    'pipeline', null, OTHER)).toBeNull();
    expect(research.validateRetell({ state: 'retell_future_unavailable', reason: 'period_missing',
      researchOnly: true, realForecastEligible: false, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false })).not.toBeNull();
    expect(research.validateRetell({ state: 'retell_future_unavailable', reason: 'period_missing',
      researchOnly: true, realForecastEligible: false, forecastIssued: false,
      paidNumericServing: false, forecastServingEnabled: false, probability: '0.1' })).toBeNull();
    const retellSaved = { state: 'retell_future_origin_saved', id: ID, asOf: INSTANT,
      localHorizonStart: '2026-11-01', researchOnly: true, amountWithheld: true,
      scope: 'retell_only_tenant_all', serviceMixAvailable: false, areaForecastAvailable: false,
      providerIndependentVerified: false, wholeBusinessCoverageVerified: false,
      realForecastEligible: false, paidNumericServing: false, forecastServingEnabled: false,
      forecastIssued: false, evidenceDigest: DIGEST, replayed: false };
    expect(research.validateRetell(retellSaved)).not.toBeNull();
    expect(research.validateRetell({ ...retellSaved, replayed: 'false' })).toBeNull();
    expect(research.validatePrerequisites(prerequisites())).not.toBeNull();
    expect(research.validatePrerequisites(prerequisites({ paidNumericServing: true }))).toBeNull();
    const nestedPrivate = prerequisites();
    nestedPrivate.seasonal.method.privateOutput = { point: 2 };
    expect(research.validatePrerequisites(nestedPrivate)).toBeNull();
    const wrongCalculation = prerequisites();
    wrongCalculation.pipeline.calculationVersion = 'invented-pipeline-method';
    expect(research.validatePrerequisites(wrongCalculation)).toBeNull();
    const transition = { state: 'transition_origin_saved', id: ID, asOf: INSTANT,
      predictionCutoffAt: INSTANT, horizonEndsAt: '2026-11-02T12:00:00.000000Z',
      targets: TRANSITION_TARGETS, sourceCoverageComplete: true,
      sourceCoverageScope: 'post_installation_northstar_selected_sources_only',
      uncertaintyState: 'unavailable_insufficient_natural_calibration', replayed: false,
      researchOnly: true, probabilityWithheld: true, outputDigestWithheld: true,
      providerCoverageVerified: false, offPlatformCoverageVerified: false,
      wholeBusinessCoverageVerified: false, naturalProductionHistoryVerified: false,
      empiricalCalibrationVerified: false, empiricalDriftVerified: false,
      realForecastEligible: false, ...flags() };
    expect(research.validateTransitionOrigin(transition)).not.toBeNull();
    expect(research.validateTransitionOrigin({ ...transition,
      targets: [...TRANSITION_TARGETS].reverse() })).toBeNull();
    expect(research.validateTransitionOrigin({ ...transition,
      horizonEndsAt: INSTANT })).toBeNull();
    expect(research.validateTransitionOrigin({ ...transition, replayed: 'false' })).toBeNull();
    const transitionCurrent = { ...transition, state: 'transition_origin_current' };
    delete transitionCurrent.replayed;
    Object.assign(transitionCurrent, { timeZone: 'America/New_York',
      methodVersion: 'm26-transition-four-target-research-v2',
      calculationVersion: 'm26-two-complete-local-month-weighted-rate-v2',
      reviewVersion: 'm26-source-finalization-human-review-v2' });
    expect(research.validateTransitionOrigin(transitionCurrent)).not.toBeNull();
    expect(research.validateTransitionOrigin({ ...transitionCurrent,
      timeZone: 'not/a-real-zone' })).toBeNull();
    const transitionEvaluation = { state: 'transition_evaluation_saved', id: ID,
      originId: OTHER, revision: 1, replayed: false, researchOnly: true,
      metricsWithheld: true, calibrationClaimed: false, driftVerdictIssued: false,
      automaticActionTaken: false, paidNumericServing: false, forecastServingEnabled: false };
    expect(research.validateTransitionEvaluation(transitionEvaluation, OTHER)).not.toBeNull();
    expect(research.validateTransitionEvaluation({ ...transitionEvaluation,
      replayed: 0 }, OTHER)).toBeNull();
    expect(research.validateDemandOrigin(seasonal({ seasonalSignalState: 'maybe_high' }),
      'seasonal')).toBeNull();
    expect(research.validateDemandOrigin({ ...pipeline(), replayed: undefined }, 'pipeline')).toBeNull();
    expect(research.validateDemandOrigin({ ...pipeline(), state: 'pipeline_origin_current',
      replayed: false }, 'pipeline')).toBeNull();
    expect(research.validateDemandEvaluation({ state: 'pipeline_evaluation_current', id: ID,
      originId: OTHER, revision: 1, replayed: false, evaluatedAt: INSTANT,
      metricsWithheld: true, ...flags() }, 'pipeline', OTHER)).toBeNull();

    const transitionReview = transitionReviewCurrent();
    expect(research.validateTransitionReview(transitionReview)).not.toBeNull();
    expect(research.validateTransitionReview({ ...transitionReview,
      targets: [...TRANSITION_TARGETS].reverse() })).toBeNull();
    expect(research.validateTransitionReview({ ...transitionReview,
      methodVersion: 'unexpected-version' })).toBeNull();
    expect(research.validateTransitionReviewMutation(transitionReviewRecorded(false),
      'approve')).not.toBeNull();
    expect(research.validateTransitionReviewMutation(transitionReviewRecorded(true),
      'approve')).not.toBeNull();
    expect(research.validateTransitionReviewMutation(transitionReviewRecorded('false'),
      'approve')).toBeNull();
    expect(research.validateTransitionReviewMutation(transitionReviewRecorded(null),
      'approve')).toBeNull();
    expect(research.validateTransitionReviewMutation(transitionReviewRecorded(undefined),
      'approve')).toBeNull();

    const reviews = { state: 'call_reviews_complete', snapshotId: ID,
      sourceSnapshotDigest: DIGEST, callCount: 1, reviewedCount: 1, unresolvedCount: 0,
      calls: [{ callSourceId: OTHER, status: 'reviewed', disposition: 'new_lead',
        anchorCallSourceId: null, reviewRevision: 1, reviewDigest: DIGEST }],
      historicalCoverageVerified: false, providerCoverageVerified: false, forecastIssued: false };
    expect(research.validateRetellReviews(reviews, ID)).not.toBeNull();
    expect(research.validateRetellReviews({ ...reviews, reviewedCount: -1,
      unresolvedCount: 2 }, ID)).toBeNull();
    expect(research.validateRetellReviews({ ...reviews, calls: [{ ...reviews.calls[0],
      disposition: 'repeat_lead', anchorCallSourceId: null }] }, ID)).toBeNull();
    expect(research.validateRetellReviews({ ...reviews, calls: [{ ...reviews.calls[0],
      disposition: 'new_lead', anchorCallSourceId: ID }] }, ID)).toBeNull();
    expect(research.validateRetellReviews({ ...reviews, calls: [{ ...reviews.calls[0],
      privateMetrics: { score: 1 } }] }, ID)).toBeNull();
    expect(research.validateRetellReviews({ ...reviews,
      sourceSnapshotDigest: 'not-a-digest' }, ID)).toBeNull();
    expect(research.validateRetellReviews({ ...reviews, reviewedCount: 1,
      unresolvedCount: 0, calls: [{ ...reviews.calls[0], status: 'unresolved', disposition: null,
        anchorCallSourceId: null, reviewRevision: 0, reviewDigest: null }] }, ID)).toBeNull();
    const unresolvedReviews = { ...reviews, state: 'call_reviews_incomplete',
      reviewedCount: 0, unresolvedCount: 1, calls: [{ callSourceId: OTHER,
        status: 'unresolved', disposition: null, anchorCallSourceId: null,
        reviewRevision: 0, reviewDigest: null }] };
    expect(research.validateRetellReviews(unresolvedReviews, ID)).not.toBeNull();
    expect(research.validateRetellReviews({ ...unresolvedReviews, calls: [{
      ...unresolvedReviews.calls[0], reviewRevision: 1, reviewDigest: DIGEST }] }, ID)).toBeNull();

    const consentItem = { id: ID, revision: 1, action: 'grant', digest: DIGEST,
      createdAt: INSTANT, reason: 'Owner permits this exact source research.',
      sourceScope: ['retell.inbound_calls'], boundary:
        'Company permission does not establish caller consent, provider coverage or retention.' };
    const consent = { state: 'company_permission_active', active: true, current: { ...consentItem },
      history: [{ ...consentItem, sourceScope: [...consentItem.sourceScope] }], total: 1,
      truncated: false, callerConsentVerified: false,
      providerCoverageVerified: false, retentionVerified: false, forecastIssued: false };
    expect(research.validateConsent(consent)).not.toBeNull();
    expect(research.validateConsent({ ...consent, active: false })).toBeNull();
    expect(research.validateConsent({ ...consent, total: 21, truncated: false })).toBeNull();

    const window = { version: 'm26-time-series-window-v1', organizationId: ID,
      businessProfileId: OTHER, businessProfileVersion: 1, businessProfileHash: DIGEST,
      timeZone: 'America/New_York', grain: 'month', serviceKey: null,
      areaScope: 'tenant_all', areaDigest: null, calendarState: 'known',
      calendarDigest: DIGEST, localStartDate: '2026-08-01', localEndDate: '2026-09-01',
      startsAt: '2026-08-01T04:00:00.000Z', endsAt: '2026-09-01T04:00:00.000Z',
      elapsedMinutes: 44640, openMinutes: 12000, openMinutesBasis: 'opening_local_date' };
    const profileWindow = { window, profileBasis: 'current_active_profile_at_read',
      historicalCalendarVerified: false, observationCoverageVerified: false,
      sourceEligibilityVerified: false, forecastIssued: false };
    expect(research.validateProfileWindow(profileWindow, '2026-08-01')).not.toBeNull();
    expect(research.validateProfileWindow({ ...profileWindow, window: {
      ...window, version: 'unexpected-window-version' } }, '2026-08-01')).toBeNull();
    expect(research.validateProfileWindow({ ...profileWindow, window: {
      ...window, areaDigest: DIGEST } }, '2026-08-01')).toBeNull();
  });

  test('does not request on load and binds a saved pipeline origin to its exact load and evaluation', async () => {
    const ui = fixture(), calls = [], keys = ['save-pipeline-key-0001', 'evaluate-pipeline-key-0002'];
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => keys.shift(), fetcher: async (url, options) => {
        calls.push({ url, method: options.method, key: options.headers['Idempotency-Key'] });
        if (url.endsWith(`/pipeline-evaluations/${OTHER}`)) return response(200, {
          state: 'pipeline_evaluation_current', id: OTHER, originId: ID, revision: 1,
          evaluatedAt: INSTANT, metricsWithheld: true, ...flags() });
        if (url.endsWith('/evaluations')) return response(201, { state: 'pipeline_evaluation_saved',
          id: OTHER, originId: ID, revision: 1, replayed: false, metricsWithheld: true, ...flags() });
        if (options.method === 'GET') return response(200, pipeline({ state: 'pipeline_origin_current',
          replayed: undefined }));
        return response(201, pipeline());
      } });
    expect(calls).toEqual([]);
    await controller.action('pipeline-save');
    expect(ui.values.commandCenterResearchPipelineId.value).toBe(ID);
    await controller.action('pipeline-load');
    await controller.action('pipeline-evaluate');
    await controller.action('pipeline-evaluation-load');
    expect(calls.map(call => call.url)).toEqual([
      '/api/v1/forecast/demand-to-schedule/pipeline-origins',
      `/api/v1/forecast/demand-to-schedule/pipeline-origins/${ID}`,
      `/api/v1/forecast/demand-to-schedule/pipeline-origins/${ID}/evaluations`,
      `/api/v1/forecast/demand-to-schedule/pipeline-evaluations/${OTHER}`,
    ]);
    expect(calls[0].key).toBe('save-pipeline-key-0001');
    expect(calls[2].key).toBe('evaluate-pipeline-key-0002');
    expect(ui.values.commandCenterResearchPipelineEvaluationId.value).toBe(OTHER);
  });

  test('requires and binds the selected origin when loading an exact evaluation receipt', async () => {
    const ui = fixture(), calls = [];
    ui.values.commandCenterResearchPipelineEvaluationId.value = OTHER;
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'unused-research-key-0001',
      fetcher: async (url) => { calls.push(url); return response(200, {
        state: 'pipeline_evaluation_current', id: OTHER, originId: OTHER, revision: 1,
        evaluatedAt: INSTANT, metricsWithheld: true, ...flags() }); } });
    await controller.action('pipeline-evaluation-load');
    expect(calls).toEqual([]);
    ui.values.commandCenterResearchPipelineId.value = ID;
    await controller.action('pipeline-evaluation-load');
    expect(calls).toEqual([`/api/v1/forecast/demand-to-schedule/pipeline-evaluations/${OTHER}`]);
    expect(ui.values.commandCenterResearchPipeline.dataset.tone).toBe('error');
    expect(ui.values.commandCenterResearchPipelineEvaluationId.value).toBe(OTHER);
  });

  test('keeps an uncertain POST identity stable and discards a superseded panel completion', async () => {
    const ui = fixture(), calls = []; let resolveFirst;
    const first = new Promise(resolve => { resolveFirst = resolve; });
    ui.values.commandCenterResearchHorizon.value = '2026-11-01';
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'stable-research-key-0001',
      fetcher: async (url, options) => {
        calls.push({ url, key: options.headers['Idempotency-Key'] });
        if (calls.length === 1) return first;
        return response(201, seasonal());
      } });
    const pending = controller.action('pipeline-save');
    await controller.action('seasonal-save');
    resolveFirst(response(201, pipeline())); await pending;
    expect(ui.values.commandCenterResearchPipelineId.value).toBe('');
    expect(ui.values.commandCenterResearchSeasonalId.value).toBe(ID);

    const failed = research.create({ mode: 'paid', document: fixture().document,
      workspaceAvailable: true, idempotency: () => 'stable-retry-key-0002',
      fetcher: async (_url, options) => { calls.push({ key: options.headers['Idempotency-Key'] });
        throw new Error('transport lost'); } });
    await failed.action('pipeline-save'); await failed.retry();
    expect(calls.slice(-2).map(call => call.key)).toEqual([
      'stable-retry-key-0002', 'stable-retry-key-0002',
    ]);
  });

  test('binds an uncertain write to its exact endpoint and body while changed input starts a new action', async () => {
    const ui = fixture(), calls = []; let count = 0;
    ui.values.commandCenterResearchHorizon.value = '2026-11-01';
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => `body-bound-key-000${++count}`,
      fetcher: async (url, options) => {
        calls.push({ url, key: options.headers['Idempotency-Key'], body: options.body });
        throw new Error('transport lost');
      } });
    await controller.action('seasonal-save');
    await controller.retry();
    ui.values.commandCenterResearchHorizon.value = '2026-12-01';
    await controller.action('seasonal-save');
    expect(calls).toEqual([
      { url: '/api/v1/forecast/demand-to-schedule/seasonal-origins',
        key: 'body-bound-key-0001', body: '{"horizonMonth":"2026-11-01"}' },
      { url: '/api/v1/forecast/demand-to-schedule/seasonal-origins',
        key: 'body-bound-key-0001', body: '{"horizonMonth":"2026-11-01"}' },
      { url: '/api/v1/forecast/demand-to-schedule/seasonal-origins',
        key: 'body-bound-key-0002', body: '{"horizonMonth":"2026-12-01"}' },
    ]);
  });

  test('does not offer a stale retry identity after a known client or conflict response', async () => {
    const ui = fixture(), calls = [], responses = [
      response(409, null, { category: 'SOURCE_CHANGED' }),
      response(201, pipeline()),
    ];
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: (() => { let n = 0;
        return () => `known-failure-key-000${++n}`; })(),
      fetcher: async (_url, options) => { calls.push(options.headers['Idempotency-Key']);
        return responses.shift(); } });
    await controller.action('pipeline-save');
    await controller.retry();
    expect(calls).toEqual(['known-failure-key-0001']);
    await controller.action('pipeline-save');
    expect(calls).toEqual(['known-failure-key-0001', 'known-failure-key-0002']);
  });

  test('loads current prerequisite tokens before explicit epoch or method decisions', async () => {
    const ui = fixture(), calls = [];
    ui.values.commandCenterResearchDecisionReason.value = 'Owner reviewed this fixed research method.';
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'setup-action-key-0001',
      fetcher: async (url, options) => {
        calls.push({ url, body: options.body && JSON.parse(options.body) });
        if (options.method === 'GET') return response(200, prerequisites());
        if (url.endsWith('/epochs')) return response(201, { state: 'demand_schedule_epoch_recorded',
          id: OTHER, purpose: 'pipeline_first_booking', revision: 1, installedAt: INSTANT,
          digest: DIGEST, replayed: false });
        return response(201, { state: 'demand_schedule_method_review_recorded', id: OTHER,
          purpose: 'seasonal_inbound', revision: 1, action: 'approve', digest: DIGEST,
          replayed: false, researchOnly: true, automaticActionTaken: false });
      } });
    await controller.action('method-seasonal-approve');
    expect(calls).toEqual([]);
    await controller.action('prerequisites-load');
    await controller.action('method-seasonal-approve');
    await controller.action('prerequisites-load');
    await controller.action('epoch-pipeline');
    expect(calls[1].body).toMatchObject({ purpose: 'seasonal_inbound', action: 'approve',
      expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    expect(calls[3].body).toEqual({ purpose: 'pipeline_first_booking', profileAnchorId: ID });
  });

  test.each([
    ['string replay', 'false', false],
    ['null replay', null, false],
    ['missing replay', undefined, false],
    ['fresh write', false, true],
    ['idempotent replay', true, true],
  ])('transition review write action enforces boolean replay for %s', async (_label, replayed, accepted) => {
    const ui = fixture(), calls = [];
    ui.values.commandCenterResearchDecisionReason.value = 'Owner reviewed this exact transition research method.';
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'transition-review-key-0001',
      fetcher: async (url, options) => {
        calls.push({ url, method: options.method });
        if (options.method === 'GET') return response(200, transitionReviewCurrent());
        return response(201, transitionReviewRecorded(replayed));
      } });
    expect(await controller.action('transition-review')).not.toBeNull();
    const result = await controller.action('transition-review-approve');
    expect(result !== null).toBe(accepted);
    expect(ui.values.commandCenterResearchTransitions.dataset.tone).toBe(accepted ? 'ready' : 'error');
    expect(calls).toEqual([
      { url: '/api/v1/forecast/demand-sources/transitions/method-reviews/current', method: 'GET' },
      { url: '/api/v1/forecast/demand-sources/transitions/method-reviews', method: 'POST' },
    ]);
  });

  test('month capture selects its bounded receipt and immediately loads exact call reviews', async () => {
    const ui = fixture(), calls = [];
    ui.values.commandCenterResearchCertificationMonth.value = '2026-08-01';
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'bounded-month-key-0001',
      fetcher: async (url, options) => {
        calls.push({ url, method: options.method });
        if (options.method === 'POST') return response(201, {
          state: 'retell_period_snapshot_saved', snapshotId: ID,
          localMonthStart: '2026-08-01', sourceWindowStartsAt: '2026-08-01T04:00:00.000000Z',
          sourceWindowEndsAt: '2026-09-01T04:00:00.000000Z', sourceSnapshotDigest: DIGEST,
          sources: [{ callSourceId: OTHER, sourceDigest: DIGEST,
            occurredAt: '2026-08-03T12:00:00.000000Z',
            recordedAt: '2026-08-03T12:01:00.000000Z' }],
          sourceCount: 1, replayed: false, reviewedLeadIdentityVerified: false,
          providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
          forecastIssued: false,
        });
        return response(200, { state: 'call_reviews_incomplete', snapshotId: ID,
          sourceSnapshotDigest: DIGEST, callCount: 1, reviewedCount: 0, unresolvedCount: 1,
          calls: [{ callSourceId: OTHER, status: 'unresolved', disposition: null,
            anchorCallSourceId: null, reviewRevision: 0, reviewDigest: null }],
          historicalCoverageVerified: false, providerCoverageVerified: false,
          forecastIssued: false });
      } });
    await controller.action('period-snapshot');
    expect(calls).toEqual([
      { url: '/api/v1/forecast/demand-sources/retell/period-snapshots', method: 'POST' },
      { url: `/api/v1/forecast/demand-sources/retell/snapshots/${ID}/reviews`, method: 'GET' },
    ]);
    expect(ui.values.commandCenterResearchPeriodSnapshotId.value).toBe(ID);
    expect(ui.values.commandCenterResearchRetellSnapshotId.value).toBe(ID);
    expect(ui.values.commandCenterResearchRetellCallSourceId.value).toBe(OTHER);
  });

  test('workspace identity changes clear private receipt IDs and stale completions', async () => {
    const ui = fixture(); let resolveCall;
    const pendingResponse = new Promise(resolve => { resolveCall = resolve; });
    const controller = research.create({ mode: 'paid', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'identity-change-key-0001',
      fetcher: async () => pendingResponse });
    controller.workspaceReady('paid:tenant-a:1:digest-a');
    const pending = controller.action('pipeline-save');
    controller.workspaceReady('paid:tenant-b:1:digest-b');
    resolveCall(response(201, pipeline())); await pending;
    expect(ui.values.commandCenterResearchPipelineId.value).toBe('');
    expect(controller.ids().pipeline).toBeNull();
    ui.values.commandCenterResearchPipelineId.value = ID;
    controller.workspaceUnavailable();
    expect(ui.values.commandCenterResearchPipelineId.value).toBe('');
  });

  test('isolated demo saves exact linked receipts, stales and recovers without a paid request', async () => {
    const ui = fixture(), fetcher = jest.fn();
    const controller = research.create({ mode: 'demo', document: ui.document,
      workspaceAvailable: true, idempotency: () => 'unused', fetcher });
    controller.workspaceReady('demo:session-a:1:expiry-a');
    expect(ui.values.commandCenterResearchDemo.hidden).toBe(false);
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional research ready');
    await controller.action('transition-review-reject');
    expect(ui.values.commandCenterResearchTransitions.dataset.tone).toBe('missing');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional research ready');
    await controller.action('transition-review-approve');
    await controller.action('transition-review');
    expect(ui.values.commandCenterResearchTransitions.dataset.tone).toBe('ready');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional origins saved');
    const firstTransition = ui.values.commandCenterResearchTransitionId.value;
    const firstPipeline = ui.values.commandCenterResearchPipelineId.value;
    expect(firstPipeline).toMatch(/^[0-9a-f-]{36}$/);
    await controller.action('pipeline-load');
    expect(ui.values.commandCenterResearchPipeline.dataset.tone).toBe('ready');
    await controller.action('transition-review-reject');
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional source changed');
    expect(ui.values.commandCenterResearchTransitionEvaluationId.value).toBe('');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional source changed');
    expect(ui.values.commandCenterResearchTransitionEvaluationId.value).toBe('');
    ui.values.commandCenterResearchTransitionId.value = firstTransition;
    await controller.action('transition-load');
    expect(ui.values.commandCenterResearchTransitions.dataset.tone).toBe('stale');
    await controller.action('transition-review-approve');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Recovered with new origins');
    const recoveredTransition = ui.values.commandCenterResearchTransitionId.value;
    const evaluatedPipeline = ui.values.commandCenterResearchPipelineId.value;
    expect(recoveredTransition).not.toBe(firstTransition);
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional evaluations ready');
    const firstTransitionEvaluation = ui.values.commandCenterResearchTransitionEvaluationId.value;
    expect(firstTransitionEvaluation).toMatch(/^[0-9a-f-]{36}$/);
    const firstEvaluation = ui.values.commandCenterResearchPipelineEvaluationId.value;
    expect(firstEvaluation).toMatch(/^[0-9a-f-]{36}$/);
    await controller.action('pipeline-evaluation-load');
    expect(ui.values.commandCenterResearchPipeline.dataset.tone).toBe('ready');
    await controller.action('transition-review-reject');
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional source changed');
    ui.values.commandCenterResearchTransitionId.value = recoveredTransition;
    ui.values.commandCenterResearchTransitionEvaluationId.value = firstTransitionEvaluation;
    await controller.action('transition-evaluation-load');
    expect(ui.values.commandCenterResearchTransitions.dataset.tone).toBe('stale');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional source changed');
    await controller.action('transition-review-approve');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Recovered with new origins');
    expect(ui.values.commandCenterResearchPipelineId.value).not.toBe(firstPipeline);
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional evaluations ready');
    controller.demoAdvance();
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional source changed');
    ui.values.commandCenterResearchPipelineId.value = firstPipeline;
    await controller.action('pipeline-load');
    expect(ui.values.commandCenterResearchPipeline.dataset.tone).toBe('stale');
    ui.values.commandCenterResearchPipelineId.value = evaluatedPipeline;
    ui.values.commandCenterResearchPipelineEvaluationId.value = firstEvaluation;
    await controller.action('pipeline-evaluation-load');
    expect(ui.values.commandCenterResearchPipeline.dataset.tone).toBe('stale');
    controller.workspaceReady('demo:session-b:1:expiry-b');
    expect(ui.values.commandCenterDemandState.textContent).toBe('Fictional research ready');
    expect(ui.values.commandCenterResearchPipelineId.value).toBe('');
    expect(ui.values.commandCenterResearchPipelineEvaluationId.value).toBe('');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('page exposes explicit setup and lifecycle controls without implementation language', () => {
    const html = fs.readFileSync('public/demo-dashboard.html', 'utf8');
    expect(html).toContain('Source and human-review setup');
    expect(html).toContain('Save seasonal origin');
    expect(html).toContain('Evaluate after horizon');
    expect(html).toContain('This source-origin authority does not provide a 4A evaluation action.');
    expect(html).toContain('Load evaluation');
    expect(html).toContain('Reset fictional research');
    expect(html).toContain('command-center-demand-research.js');
    expect(html).not.toMatch(/migration 22|SQL|SECURITY DEFINER/i);
  });
});
