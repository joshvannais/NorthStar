'use strict';

const { v5: uuidv5 } = require('uuid');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const { verifiedJourney } = require('./forecastPaidJourneyRepository');
const { exactMoney, verifyApprovedPriceDecision } = require('../commandCenter/demoApprovedPriceDecision');

const STATE_VERSION = 'm26-demo-paid-journey-state-v1';
const PUBLIC_VERSION = 'm26-paid-journey-v1';
const TARGET_KEY = 'revenue.approved_price_flow';
const TARGET_VERSION = 'v1';
const TARGET_SEMANTIC = 'future_human_approved_commercial_price_decisions';
const ALGORITHM_KEY = 'approved_price_carry_forward';
const ALGORITHM_VERSION = 'm26-paid-approved-price-flow-v1';
const NAMESPACE = '2dc5d42f-7595-4bd8-9ba1-f7e862e392f0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const REVIEW_TRADEOFF = 'Review can inform a later independently authorized workflow; no receiver or operational state changes here.';
const MISSING_INFORMATION = Object.freeze([
  'natural_observation_history',
  'empirical_calibration',
  'whole_business_coverage',
  'live_provider_validation',
]);

function fail(status, code, message) {
  const error = new Error(message); error.status = status; error.code = code; throw error;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(); const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function iso(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(503, 'DEMO_FORECAST_STATE_INVALID', 'The fictional forecast journey is unavailable.');
  return parsed.toISOString();
}

function identity(state, label) {
  return uuidv5(`${STATE_VERSION}:${state.seed}:${state.generation}:${label}`, NAMESPACE);
}

function nextMonth(value, offset) {
  const source = new Date(value);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + offset, 1)).toISOString();
}

function unavailableSource() {
  fail(503, 'DEMO_FORECAST_SOURCE_UNAVAILABLE',
    'An explicit fictional human-approved commercial price decision is unavailable.');
}

function orderedGraphs(state) {
  if (!Array.isArray(state && state.graphs) || state.graphs.length === 0) unavailableSource();
  const timed = state.graphs.map((graph, index) => {
    const createdAt = Date.parse(graph && graph.timestamps && graph.timestamps.createdAt);
    if (!Number.isFinite(createdAt)) unavailableSource();
    return { graph, index, createdAt };
  });
  return timed.sort((left, right) => right.createdAt - left.createdAt || left.index - right.index)
    .map(value => value.graph);
}

function sourceGraph(state, approvedPriceOriginId = null) {
  const graphs = orderedGraphs(state);
  const graph = approvedPriceOriginId === null
    ? graphs[0]
    : graphs.find(candidate => candidate && candidate.ids?.estimate === approvedPriceOriginId);
  const estimateMoney = exactMoney(graph && graph.estimate && graph.estimate.customerPrice);
  const snapshotMoney = exactMoney(graph && graph.polaris && graph.polaris.snapshot &&
    graph.polaris.snapshot.customerFacingPrice);
  if (!graph || graph.source?.type !== 'account_free_demo' || graph.estimate?.fictional !== true ||
      !UUID.test(graph.ids?.graph || '') || !UUID.test(graph.ids?.estimate || '') ||
      !UUID.test(graph.ids?.polarisSnapshot || '') || !DIGEST.test(graph.polaris?.snapshotDigest || '') ||
      graph.estimate.currency !== 'USD' || !estimateMoney || !snapshotMoney ||
      estimateMoney.minorUnits !== snapshotMoney.minorUnits ||
      !verifyApprovedPriceDecision(graph.estimate.approvedPriceDecision, {
        tenantId: state.workspace?.tenant?.id,
        graphId: graph.ids.graph,
        estimateId: graph.ids.estimate,
        sourceSnapshotId: graph.ids.polarisSnapshot,
        sourceSnapshotDigest: graph.polaris.snapshotDigest,
        amount: graph.estimate.customerPrice,
        currency: graph.estimate.currency,
        approvedAt: graph.timestamps?.createdAt,
      })) unavailableSource();
  return graph;
}

function sourceBasis(state, approvedPriceOriginId = null) {
  if (!state || !DIGEST.test(state.seed || '') || !Number.isSafeInteger(state.generation) ||
      !state.workspace || !UUID.test(state.workspace.tenant?.id || '')) unavailableSource();
  const graph = sourceGraph(state, approvedPriceOriginId);
  const amount = exactMoney(graph.estimate.customerPrice);
  const decision = graph.estimate.approvedPriceDecision;
  const capturedAt = iso(graph.timestamps?.createdAt);
  const cutoffAt = iso(graph.timestamps?.snapshotCreatedAt);
  if (Date.parse(capturedAt) > Date.parse(cutoffAt)) {
    unavailableSource();
  }
  const value = {
    approvedPriceOriginId: graph.ids.estimate,
    approvalDecisionId: decision.id,
    approvalDecisionDigest: decision.digest,
    positionId: identity(state, 'position'),
    sourceSnapshotId: graph.ids.polarisSnapshot,
    sourceSnapshotDigest: graph.polaris.snapshotDigest,
    amount: amount.amount,
    amountMinorUnits: amount.minorUnits,
    currency: graph.estimate.currency,
    capturedAt,
    cutoffAt,
    sourceLabel: `${graph.lead.serviceLabel} · fictional human-approved commercial decision`,
  };
  return stableValue({
    ...value,
    positionDigest: sha256({ contract: 'm26-demo-approved-price-position-v1', ...value }),
    reportingWindowDigest: sha256({ contract: 'm26-demo-approved-price-window-v1',
      cutoffAt, sourceSnapshotDigest: graph.polaris.snapshotDigest }),
    featureSetDigest: sha256({ contract: 'm26-demo-approved-price-feature-v1',
      approvedPriceOriginId: graph.ids.estimate, approvalDecisionDigest: decision.digest,
      amount: value.amount, amountMinorUnits: value.amountMinorUnits, currency: value.currency }),
  });
}

function settings(state) {
  const value = {
    revision: 1,
    enabled: true,
    targets: [TARGET_KEY],
    horizon: { grain: 'month', periods: 1 },
    actionPolicy: 'review_required',
    fictional: true,
  };
  return stableValue({ revision: 1, digest: sha256({ contract: 'm26-demo-forecast-settings-v1', seed: state.seed, value }), value });
}

function algorithm() {
  return stableValue({
    key: ALGORITHM_KEY,
    version: ALGORITHM_VERSION,
    definitionDigest: sha256({ contract: 'm26-approved-price-flow-definition-v1', target: TARGET_KEY, semantic: TARGET_SEMANTIC }),
    implementationDigest: sha256({ contract: 'm26-paid-approved-price-flow-implementation-v1', operation: 'carry_forward_exact_origin' }),
    configurationDigest: sha256({ contract: 'm26-demo-approved-price-flow-configuration-v1', fictional: true, horizonPeriods: 1 }),
  });
}

function output(source, target, horizon, method) {
  const value = {
    predictionKind: 'deterministic_point',
    value: { amount: source.amount },
    unit: { key: 'money', currency: source.currency },
    uncertainty: { state: 'unquantified', calibratedIntervalAvailable: false },
    fictional: true,
  };
  return stableValue({ ...value, digest: sha256({
    contract: 'm26-approved-price-flow-output-v1', target, horizon, algorithm: method,
    sourcePositionDigest: source.positionDigest, value,
  }) });
}

function createRun(state, reason, issuedAt, approvedPriceOriginId = null) {
  const source = sourceBasis(state, approvedPriceOriginId); const selectedSettings = settings(state);
  const target = stableValue({ key: TARGET_KEY, definitionVersion: TARGET_VERSION, semantic: TARGET_SEMANTIC });
  const horizon = stableValue({ grain: 'month', startsAt: nextMonth(source.cutoffAt, 1), endsAt: nextMonth(source.cutoffAt, 2) });
  const method = algorithm(); const calculated = output(source, target, horizon, method);
  const explanation = {
    summary: 'This fictional example carries one exact pre-horizon approved price into the next monthly review window.',
    sourceCoverage: 'One synthetic, account-free NorthStar demo estimate. It is not customer data or live provider evidence.',
    uncertainty: 'A calibrated interval, empirical accuracy, natural history, and whole-business coverage are unavailable.',
    customerSafe: true,
    advisoryOnly: true,
    fictional: true,
  };
  explanation.digest = sha256({ contract: 'm26-approved-price-flow-explanation-v1',
    sourcePositionDigest: source.positionDigest, outputDigest: calculated.digest, explanation });
  const run = {
    id: identity(state, 'run'),
    settings: { revision: selectedSettings.revision, digest: selectedSettings.digest },
    source: { positionId: source.positionId, positionDigest: source.positionDigest,
      sourceSnapshotDigest: source.sourceSnapshotDigest,
      reportingWindowDigest: source.reportingWindowDigest, featureSetDigest: source.featureSetDigest,
      approvedPriceOriginId: source.approvedPriceOriginId,
      approvalDecisionId: source.approvalDecisionId,
      approvalDecisionDigest: source.approvalDecisionDigest,
      amountMinorUnits: source.amountMinorUnits, capturedAt: source.capturedAt,
      cutoffAt: source.cutoffAt, fictional: true },
    target, horizon, algorithm: method, output: calculated, explanation,
    receipt: { organizationId: state.workspace.tenant.id, digest: null,
      issuedAt: iso(issuedAt), reason, fictional: true },
    currentness: { state: 'unchanged_candidate', revision: 1, digest: null,
      adviceDisplayAuthorized: false, checkedAt: iso(issuedAt), fictional: true },
    review: { receiverAvailability: 'unavailable', receiverReason: 'no_exact_receiving_adapter',
      receiverHref: null, history: [], advisoryOnly: true, receiverMutationCount: 0 },
    automaticActionAuthorized: false,
    outboundCommunicationAuthorized: false,
  };
  run.receipt.digest = sha256({ contract: 'm26-demo-paid-journey-receipt-v1',
    runId: run.id, settings: run.settings, source: run.source, target, horizon,
    algorithm: method, outputDigest: calculated.digest, explanationDigest: explanation.digest,
    issuedAt: run.receipt.issuedAt, reason });
  run.currentness.digest = sha256({ contract: 'm26-demo-paid-journey-currentness-v1',
    runId: run.id, runDigest: run.receipt.digest, revision: 1,
    sourcePositionDigest: source.positionDigest, state: 'unchanged_candidate' });
  return stableValue(run);
}

function stateValue(value, sourceState) {
  if (value === undefined) return null;
  if (!exact(value, ['version','reason','run']) || value.version !== STATE_VERSION ||
      typeof value.reason !== 'string' || value.reason.length < 10 || value.reason.length > 1000 || !value.run) {
    fail(503, 'DEMO_FORECAST_STATE_INVALID', 'The fictional forecast journey is unavailable.');
  }
  const expected = createRun(sourceState, value.reason, value.run.receipt?.issuedAt,
    value.run.source?.approvedPriceOriginId);
  const originalHistory = value.run.review?.history;
  const candidate = stableValue({ ...expected, review: { ...expected.review, history: originalHistory } });
  const envelope = journeyEnvelope({ ...sourceState, forecastJourney: { ...value, run: candidate } }, 1, new Date(), false);
  if (sha256(candidate) !== sha256(value.run) || envelope.state !== 'current') {
    fail(503, 'DEMO_FORECAST_STATE_INVALID', 'The fictional forecast journey is unavailable.');
  }
  return stableValue({ ...value, run: candidate });
}

function latestHistory(run, now) {
  return run.review.history.map((event, index, events) => {
    if (index === events.length - 1 && event.recordedAction === 'requested' &&
        Date.parse(event.expiresAt) <= now.getTime()) return { ...event, action: 'expired' };
    return event;
  });
}

function projectedCurrentness(state, run) {
  const latest = sourceBasis(state);
  if (latest.approvedPriceOriginId === run.source.approvedPriceOriginId &&
      latest.sourceSnapshotDigest === run.source.sourceSnapshotDigest &&
      latest.positionDigest === run.source.positionDigest) return run.currentness;
  const candidates = orderedGraphs(state);
  const pinnedIndex = candidates.findIndex(candidate =>
    candidate.ids.estimate === run.source.approvedPriceOriginId);
  if (pinnedIndex < 0) {
    fail(503, 'DEMO_FORECAST_STATE_INVALID', 'The fictional forecast journey is unavailable.');
  }
  const revision = run.currentness.revision + Math.max(1, pinnedIndex);
  const checkedAt = latest.capturedAt;
  return stableValue({
    state: 'stale', revision, digest: sha256({
      contract: 'm26-demo-paid-journey-currentness-v1', runId: run.id,
      runDigest: run.receipt.digest, revision,
      sourcePositionDigest: run.source.positionDigest, state: 'stale',
      reason: 'newer_fictional_source', latestSourcePositionDigest: latest.positionDigest,
    }),
    adviceDisplayAuthorized: false, checkedAt, fictional: true,
    reason: 'newer_fictional_source',
  });
}

function journeyEnvelope(state, workspaceRevision, now = new Date(), validateStored = true) {
  const source = sourceBasis(state);
  if (!state.forecastJourney) {
    return verifiedJourney({
      version: PUBLIC_VERSION, state: 'ready', reason: null, run: null, review: null,
      targetKey: TARGET_KEY, syntheticImplementationEvidenceOnly: true,
      liveValidationAvailable: false, automaticActionAuthorized: false,
      fictionalDemo: true, accountFree: true, resettable: true, providerCallCount: 0,
      demoWorkspaceRevision: workspaceRevision,
      sourceCandidate: { approvedPriceOriginId: source.approvedPriceOriginId,
        approvalDecisionId: source.approvalDecisionId,
        approvalDecisionDigest: source.approvalDecisionDigest,
        positionId: source.positionId, positionDigest: source.positionDigest,
        sourceSnapshotDigest: source.sourceSnapshotDigest, capturedAt: source.capturedAt,
        cutoffAt: source.cutoffAt, amount: source.amount,
        amountMinorUnits: source.amountMinorUnits, currency: source.currency,
        label: source.sourceLabel, fictional: true },
    }, state.workspace.tenant.id);
  }
  const saved = validateStored ? stateValue(state.forecastJourney, state) : state.forecastJourney;
  const run = stableValue({ ...saved.run, currentness: projectedCurrentness(state, saved.run),
    review: { ...saved.run.review,
    history: latestHistory(saved.run, now) } });
  const latest = run.review.history[run.review.history.length - 1];
  return verifiedJourney({
    version: PUBLIC_VERSION, state: 'current', reason: null, run,
    review: { availability: 'unavailable', reason: 'no_exact_receiving_adapter',
      requestReviewAvailable: run.currentness.state === 'unchanged_candidate' &&
        (!latest || ['dismissed','expired'].includes(latest.action)) },
    targetKey: TARGET_KEY, syntheticImplementationEvidenceOnly: true,
    liveValidationAvailable: false, automaticActionAuthorized: false,
    fictionalDemo: true, accountFree: true, resettable: true, providerCallCount: 0,
    demoWorkspaceRevision: workspaceRevision, sourceCandidate: null,
  }, state.workspace.tenant.id);
}

function normalizeAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['issue','rerun','requested','dismissed'].includes(value.action)) {
    fail(400, 'DEMO_FORECAST_REQUEST_INVALID', 'Check the fictional forecast journey request.');
  }
  if (value.action === 'issue') {
    if (!exact(value, ['action','approvedPriceOriginId','reason']) || !UUID.test(value.approvedPriceOriginId || '') ||
        typeof value.reason !== 'string' || value.reason.trim().length < 10 || value.reason.trim().length > 1000) {
      fail(400, 'DEMO_FORECAST_REQUEST_INVALID', 'Check the fictional source and review reason.');
    }
    return stableValue({ action: 'issue', approvedPriceOriginId: value.approvedPriceOriginId, reason: value.reason.trim() });
  }
  if (value.action === 'rerun') {
    if (!exact(value, ['action','runId','runDigest','currentnessDigest']) || !UUID.test(value.runId || '') ||
        !DIGEST.test(value.runDigest || '') || !DIGEST.test(value.currentnessDigest || '')) {
      fail(400, 'DEMO_FORECAST_REQUEST_INVALID', 'Choose one exact fictional run receipt.');
    }
    return stableValue(value);
  }
  const expiresAt = Date.parse(value.expiresAt);
  if (!exact(value, ['action','runId','runDigest','currentnessDigest','expectedRevision','expectedDigest','expiresAt']) ||
      !UUID.test(value.runId || '') || !DIGEST.test(value.runDigest || '') ||
      !DIGEST.test(value.currentnessDigest || '') || !Number.isFinite(expiresAt) ||
      (value.action === 'requested' ? value.expectedRevision !== null || value.expectedDigest !== null :
        !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 || !DIGEST.test(value.expectedDigest || ''))) {
    fail(400, 'DEMO_FORECAST_REQUEST_INVALID', 'Check the fictional review request.');
  }
  return stableValue(value);
}

function reviewEvent(state, run, action, input, keyHash, now) {
  const history = run.review.history; const prior = history[history.length - 1] || null;
  const expiresAt = iso(input.expiresAt);
  if (action === 'requested') {
    if (Date.parse(expiresAt) <= now.getTime() + 3600000 || Date.parse(expiresAt) > now.getTime() + 30 * 86400000 ||
        (prior && prior.recordedAction === 'requested' && Date.parse(prior.expiresAt) > now.getTime())) {
      fail(409, 'DEMO_FORECAST_REVIEW_CHANGED', 'Refresh the fictional review history before requesting review.');
    }
  } else if (!prior || prior.recordedAction !== 'requested' || Date.parse(prior.expiresAt) <= now.getTime() ||
      input.expectedRevision !== prior.revision || input.expectedDigest !== prior.digest || input.expiresAt !== prior.expiresAt) {
    fail(409, 'DEMO_FORECAST_REVIEW_CHANGED', 'The fictional review changed. Refresh before dismissing it.');
  }
  if (history.length >= 20) fail(429, 'DEMO_FORECAST_REVIEW_LIMIT', 'This demo reached its fictional review-history limit. Reset to start over.');
  const event = {
    revision: history.length + 1, action, recordedAction: action,
    recordedAt: iso(now), expiresAt,
    organizationId: state.workspace.tenant.id, runId: run.id,
    actorUserId: identity(state, 'reviewer'), actorAccessRole: 'owner',
    predecessorDigest: prior ? prior.digest : null,
    runDigest: run.receipt.digest, currentnessRevision: run.currentness.revision,
    currentnessDigest: run.currentness.digest,
    target: run.target, horizon: run.horizon, outputDigest: run.output.digest,
    recommendationType: 'review_approved_price_flow',
    receiving: { mission: null, workflow: null, recordId: null, expectedRevision: null,
      availability: 'unavailable', reason: 'no_exact_receiving_adapter' },
    evidence: { receiptDigest: run.receipt.digest, explanationDigest: run.explanation.digest,
      sourcePositionDigest: run.source.positionDigest },
    uncertainty: { state: 'unquantified', calibratedIntervalAvailable: false,
      reason: 'empirical_calibration_unavailable' },
    missingInformation: MISSING_INFORMATION.slice(), tradeoff: REVIEW_TRADEOFF, digest: null,
  };
  event.digest = sha256({ contract: 'm26-demo-paid-journey-review-v1', keyHash, event });
  return stableValue(event);
}

function apply(state, input, keyHash, now = new Date()) {
  if (!DIGEST.test(keyHash || '')) fail(503, 'DEMO_FORECAST_STATE_INVALID', 'The fictional forecast request identity is unavailable.');
  const action = normalizeAction(input);
  if (action.action === 'issue') {
    if (state.forecastJourney) fail(409, 'DEMO_FORECAST_ALREADY_ISSUED', 'Reset the fictional demo before issuing another journey.');
    const source = sourceBasis(state);
    if (action.approvedPriceOriginId !== source.approvedPriceOriginId) {
      fail(409, 'DEMO_FORECAST_SOURCE_CHANGED', 'The fictional approved-price source changed. Refresh before issuing.');
    }
    return stableValue({ ...state, forecastJourney: { version: STATE_VERSION,
      reason: action.reason, run: createRun(state, action.reason, now) } });
  }
  const saved = stateValue(state.forecastJourney, state);
  const currentness = saved && projectedCurrentness(state, saved.run);
  if (saved && currentness.state !== 'unchanged_candidate') {
    fail(409, 'DEMO_FORECAST_SOURCE_CHANGED', 'A newer fictional source requires a fresh review. Reset before continuing.');
  }
  if (!saved || action.runId !== saved.run.id || action.runDigest !== saved.run.receipt.digest ||
      action.currentnessDigest !== saved.run.currentness.digest) {
    fail(409, 'DEMO_FORECAST_RUN_CHANGED', 'The fictional run changed. Refresh before continuing.');
  }
  if (action.action === 'rerun') return stableValue(state);
  const event = reviewEvent(state, saved.run, action.action, action, keyHash, now);
  const run = stableValue({ ...saved.run, review: { ...saved.run.review,
    history: saved.run.review.history.concat(event) } });
  return stableValue({ ...state, forecastJourney: { ...saved, run } });
}

function rerunProjection(state, workspaceRevision, input) {
  const action = normalizeAction(input); const saved = stateValue(state.forecastJourney, state);
  const currentness = saved && projectedCurrentness(state, saved.run);
  if (action.action !== 'rerun' || !saved || currentness.state !== 'unchanged_candidate' ||
      action.runId !== saved.run.id ||
      action.runDigest !== saved.run.receipt.digest || action.currentnessDigest !== saved.run.currentness.digest) {
    return stableValue({ state: 'unavailable',
      reason: currentness?.state === 'stale' ? 'source_changed' : 'run_changed', runId: null,
      comparison: null, automaticActionAuthorized: false, fictionalDemo: true,
      providerCallCount: 0, demoWorkspaceRevision: workspaceRevision });
  }
  const fresh = createRun(state, saved.reason, saved.run.receipt.issuedAt,
    saved.run.source.approvedPriceOriginId);
  return stableValue({ state: fresh.output.digest === saved.run.output.digest ? 'reproduced' : 'result_mismatch',
    runId: saved.run.id, runDigest: saved.run.receipt.digest,
    storedOutputDigest: saved.run.output.digest, freshOutputDigest: fresh.output.digest,
    sameResults: fresh.output.digest === saved.run.output.digest,
    automaticActionAuthorized: false, fictionalDemo: true, providerCallCount: 0,
    demoWorkspaceRevision: workspaceRevision });
}

function validate(value, sourceState) { stateValue(value, sourceState); return true; }

module.exports = {
  PUBLIC_VERSION,
  STATE_VERSION,
  TARGET_KEY,
  apply,
  journeyEnvelope,
  normalizeAction,
  rerunProjection,
  sourceBasis,
  validate,
};
