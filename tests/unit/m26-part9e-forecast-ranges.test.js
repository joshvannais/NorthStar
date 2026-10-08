'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function api() {
  const context = { window: {}, console, Date, Number, Promise, Reflect, encodeURIComponent };
  context.window.window = context.window;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,
    '../../public/js/command-center-forecast-ranges.js'), 'utf8'), context);
  return context.window.NorthStarForecastRanges;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const ORIGIN = '90000000-0000-4000-8000-000000000009';
const ID = '10000000-0000-4000-8000-000000000001';
const ESTIMATE = '20000000-0000-4000-8000-000000000002';
const HASH = character => character.repeat(64);
const PAID = Object.freeze({ tenantId: 'tenant-paid', role: 'owner', mode: 'paid', fictional: false });
const DEMO = Object.freeze({ tenantId: 'tenant-demo', role: 'viewer', mode: 'demo', fictional: true });

class Element {
  constructor() { this.textContent = ''; this.dataset = {}; this.children = [];
    this.attributes = {}; this.className = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
}
function renderedText(node) {
  return [node.textContent].concat(node.children.map(renderedText)).filter(Boolean).join(' ');
}
const ids = ['commandCenterForecastRanges', 'commandCenterForecastState',
  'commandCenterForecastExplanation', 'commandCenterForecastBoundary',
  'commandCenterForecastStatus', 'commandCenterForecastEvidenceMap',
  'commandCenterForecastEvidenceDescription', 'commandCenterForecastAuthority'];
for (const name of ['Baseline', 'Range', 'Scenario', 'Sensitivity']) {
  ids.push(`commandCenterForecast${name}State`, `commandCenterForecast${name}Value`,
    `commandCenterForecast${name}Context`, `commandCenterForecast${name}Details`);
}
function documentFixture() {
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  return { elements, document: { getElementById: id => elements[id],
    createElement: () => new Element() } };
}
function response(data, ok = true) {
  return { ok, json: async () => ok ? { success: true, data } :
    { success: false, error: { message: 'unavailable' } } };
}
function currentRange() {
  const value = clone(api().demoBundle().range);
  value.reason = 'calibration_evidence_not_established';
  value.range.reason = value.reason; value.distribution.reason = value.reason;
  value.baselineIdentity = {
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1',
      sourceScope: 'retell_only_tenant_all' }, unit: { key: 'count', currency: null },
    horizon: { localStart: '2026-11-01', startsAt: '2026-11-01T04:00:00.000000Z',
      endsAt: '2026-12-01T05:00:00.000000Z', grain: 'business_local_month',
      timeZone: 'America/New_York' }, scope: { sourceScope: 'retell_only_tenant_all',
      serviceKey: null, areaKey: null, dimensionKeys: [] },
    profile: { businessProfileId: ID, businessProfileVersion: 1,
      businessProfileHash: HASH('a'), timeZone: 'America/New_York' },
    sourceAsOf: '2026-10-01T12:00:00.000000Z', sourceSnapshotDigest: HASH('b'),
    sourceReceiptDigest: HASH('c'), baselineDigest: HASH('d'),
    configurationDigest: HASH('e'), algorithm: { key: 'retell_three_complete_month_mean',
      version: 'm26-retell-three-month-mean-v2', definitionDigest: HASH('f'),
      implementationDigest: HASH('1'), buildIdentity: {
        kind: 'postgresql_function_definition_sha256', procedure:
          'public.canonical_forecast_retell_future_origin_v2_capture(uuid,uuid,text,uuid,text,text,date)' } } };
  value.currentness = { baselineCurrent: true, evidenceCurrent: false,
    refreshRequired: true, correctionOrRevocationApplied: false };
  value.digests.assessment = HASH('2'); value.sourceAuthenticated = true;
  return value;
}

function currentScenario() {
  const scenario = clone(api().demoBundle().scenario);
  scenario.state = 'current'; scenario.reason = null;
  scenario.checkedAt = '2026-10-08T12:00:01.000000Z';
  scenario.asOf = '2026-10-08T12:00:00.000000Z'; scenario.currency = 'USD';
  scenario.horizon = { startsAt: '2026-11-01T04:00:00.000000Z',
    endsAt: '2026-12-01T05:00:00.000000Z', upperBoundary: 'exclusive',
    timeZone: 'America/New_York' };
  scenario.sourceSnapshot = { state: 'complete_as_of', digest: HASH('a'),
    profile: { id: ID, version: 1, hash: HASH('9'), anchorId: ID,
      timeZone: 'America/New_York' },
    pipelinePolicy: { id: ID, revision: 1, digest: HASH('8') },
    statuses: { estimateCount: 0, authoritativeOpenRiskCount: 0, scenarioMemberCount: 0,
      preliminaryEstimateCount: 0, approvedUnbookedCount: 0, withdrawnExcludedCount: 0,
      reviewedUnconfirmedExcludedCount: 0, confirmedBookedExcludedCount: 0,
      correctedExcludedCount: 0, cancelledExcludedCount: 0,
      outsideAuthoritativeOpenRiskExcludedCount: 0 },
    estimateHighWaterOrder: 1, pipelineEpochId: ID,
    pipelineEpochDigest: HASH('b'), openRiskDigest: HASH('c'),
    integratedCommercialSourceDigest: HASH('d'), completeAsOf: true, hasMore: false };
  scenario.scenarioReview = { id: ID, revision: 1, authorUserId: ID, membershipId: ID,
    recordedAt: '2026-10-08T12:00:00.000000Z', digest: HASH('e') };
  scenario.scenarios = Object.fromEntries(['adverse', 'base', 'favorable'].map((name, index) =>
    [name, { state: 'assumption_only', reason: null,
      preliminaryEstimate: `${10 + index}.000000`, approvedUnbooked: `${20 + index}.000000`,
      total: `${30 + index * 2}.000000` }]));
  scenario.digests = { source: HASH('a'), assumptions: HASH('f'), output: HASH('1'),
    review: HASH('e'), currentness: HASH('2') };
  scenario.currentness = { reviewCurrent: true, sourceCurrent: true, policyCurrent: true,
    profileCurrent: true, refreshRequired: false, correctionOrRevocationApplied: false };
  scenario.sourceAuthenticated = true; scenario.assumptionSourcesAuthenticated = true;
  scenario.forecastIssued = true;
  return scenario;
}
function currentSensitivity(impossible = false) {
  const scenario = currentScenario();
  const baseAssumption = { weightPpm: 250000,
    changedAssumption: { field: 'conversion_weight_ppm', fromWeightPpm: 250000,
      toWeightPpm: 250000 },
    reason: 'Use the approved exact central policy for this estimate.',
    author: { userId: ID, membershipId: ID },
    source: { kind: 'owner_approved_scenario_assumption', digest: HASH('7') },
    recordedAt: '2026-10-08T12:00:00.000000Z', applicability: {
      estimateId: ESTIMATE, estimateSnapshotDigest: HASH('3'),
      category: 'preliminary_estimate' }, revision: 1 };
  return { version: 'm26-pipeline-sensitivity-v1', state: 'assumption_only', reason: null,
    checkedAt: '2026-10-08T12:00:02.000000Z', asOf: scenario.asOf,
    horizon: scenario.horizon, currency: 'USD', scenario: { reviewId: ID, reviewRevision: 1,
      reviewDigest: HASH('e'), sourceSnapshotDigest: HASH('a'), assumptionDigest: HASH('f'),
      currentnessDigest: HASH('2') }, selectedEstimate: { id: ESTIMATE,
      snapshotDigest: HASH('3'), category: 'preliminary_estimate',
      decision: { id: null, revision: null, digest: null },
      issuedVersion: { id: null, revision: null, digest: null },
      priceBeforeTax: '100.00', currency: 'USD', baseAssumption },
    target: { kind: 'minimum_category_total', category: 'preliminary_estimate',
      minimumAmount: '40.000000', definition: { key: 'pipeline.minimum_category_total',
        version: 'v1', digest: HASH('6') }, provenance: { kind: 'authorized_user_input',
        actorUserId: ID, digest: HASH('6') },
      interpretation: 'user_selected_what_if_threshold' }, constraint: {
      kind: 'selected_estimate_conversion_weight',
      bounds: { lowerPpm: 100000, basePpm: 250000, upperPpm: 500000 },
      definition: { key: 'pipeline.selected_estimate_conversion_weight', version: 'v1',
        digest: HASH('6') }, provenance: { kind: 'owner_approved_pipeline_policy',
        id: ID, revision: 1, digest: HASH('6') } },
    forward: { state: 'assumption_only', reason: null,
      changedAssumption: { field: 'conversion_weight_ppm', fromWeightPpm: 250000,
        toWeightPpm: 400000 }, selectedEstimate: { baselineAmount: '25.000000',
        proposedAmount: '40.000000', changeAmount: '15.000000' },
      categoryTotal: { baselineAmount: '25.000000', proposedAmount: '40.000000',
        changeAmount: '15.000000' }, bindingConstraint: null },
    reverse: impossible ? { state: 'impossible',
      reason: 'target_exceeds_selected_weight_bound', requiredWeightPpm: null,
      selectedEstimateAmount: null, categoryTotal: null,
      bindingConstraint: { kind: 'selected_weight_upper_bound', weightPpm: 500000 } } :
      { state: 'assumption_only', reason: null, requiredWeightPpm: 400000,
        selectedEstimateAmount: '40.000000', categoryTotal: { minimumAmount: '40.000000',
          attainedAmount: '40.000000', changeFromBaselineAmount: '15.000000' },
        bindingConstraint: null }, digests: { input: HASH('4'), output: HASH('5'),
      source: HASH('a'), assumptions: HASH('f'), review: HASH('e'), currentness: HASH('2') },
    currentness: { scenarioCurrent: true, sourceCurrent: true, assumptionsCurrent: true,
      policyCurrent: true, profileCurrent: true, refreshRequired: false,
      correctionOrRevocationApplied: false }, sourceAuthenticated: true,
    assumptionSourcesAuthenticated: true, weightsAreScenarioAssumptions: true,
    probabilityCalibrated: false, percentilesIssued: false, targetIsWhatIfThreshold: true,
    earnedRevenueMeasured: false, cashMeasured: false, recommendationIssued: false,
    researchOnly: true, realForecastEligible: false, analysisIssued: true,
    paidNumericServing: false, automaticActionAuthorized: false };
}

describe('Mission 26 original Part 9E forecast evidence UI', () => {
  test('accepts released value-free contracts and rejects fabricated range claims or extra data', () => {
    const browser = api(); const bundle = browser.demoBundle();
    expect(browser.validateBaseline(bundle.baseline)).not.toBeNull();
    expect(browser.validateRange(bundle.range)).not.toBeNull();
    expect(browser.validateRange(currentRange())).not.toBeNull();
    expect(browser.validateScenario(bundle.scenario)).not.toBeNull();
    expect(browser.validateSensitivity(bundle.sensitivity)).not.toBeNull();
    expect(browser.validateScenario(currentScenario())).not.toBeNull();
    expect(browser.validateSensitivity(currentSensitivity())).not.toBeNull();
    expect(browser.validateSensitivity(currentSensitivity(true))).not.toBeNull();

    const p10 = clone(bundle.range); p10.range.p10 = '0';
    expect(browser.validateRange(p10)).toBeNull();
    const claimed = clone(bundle.range); claimed.range.empiricalCalibrationClaimed = true;
    expect(browser.validateRange(claimed)).toBeNull();
    const probability = currentScenario(); probability.probabilityCalibrated = true;
    expect(browser.validateScenario(probability)).toBeNull();
    const crossed = currentScenario();
    crossed.scenarios.adverse.total = '40.000000';
    expect(browser.validateScenario(crossed)).toBeNull();
    const lateSource = currentRange();
    lateSource.baselineIdentity.sourceAsOf = lateSource.baselineIdentity.horizon.startsAt;
    expect(browser.validateRange(lateSource)).toBeNull();
    const inventedUnavailableReason = clone(bundle.baseline);
    inventedUnavailableReason.reason = 'fictional_demo_source_snapshot_unavailable';
    expect(browser.validateBaseline(inventedUnavailableReason)).toBeNull();
    const automatic = currentSensitivity(); automatic.automaticActionAuthorized = true;
    expect(browser.validateSensitivity(automatic)).toBeNull();
    const extra = clone(bundle.baseline); extra.tenantSecret = 'must-not-pass';
    expect(browser.validateBaseline(extra)).toBeNull();
  });

  test('uses one renderer for isolated fictional demo without calling paid routes', async () => {
    const browser = api(); const fixture = documentFixture(); let calls = 0;
    const controller = browser.create({ mode: 'demo', document: fixture.document,
      fetcher: async () => { calls += 1; throw new Error('demo must not call paid routes'); } });
    await controller.workspaceReady(DEMO);
    expect(calls).toBe(0);
    expect(fixture.elements.commandCenterForecastState.textContent).toBe('Fictional evidence');
    expect(fixture.elements.commandCenterForecastRangeValue.textContent)
      .toBe('P10 / P50 / P90 withheld');
    expect(fixture.elements.commandCenterForecastRangeContext.textContent)
      .toMatch(/No calibrated probability distribution/);
    expect(fixture.elements.commandCenterForecastScenarioValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterForecastEvidenceMap.children).toHaveLength(4);
    expect(renderedText(fixture.elements.commandCenterForecastAuthority))
      .toMatch(/Authenticated tenant tenant-demo.*Authenticated role viewer.*Fictional isolated data Yes/);
  });

  test('clears stale values before paid loading, fails metrics closed, and recovers without demo fallback', async () => {
    const browser = api(); const bundle = browser.demoBundle(); const fixture = documentFixture();
    const pending = []; const calls = [];
    const controller = browser.create({ mode: 'paid', document: fixture.document,
      originProvider: () => ORIGIN, fetcher: url => { calls.push(url);
        return new Promise(resolve => pending.push(resolve)); } });
    fixture.elements.commandCenterForecastBaselineValue.textContent = 'stale point 0';
    fixture.elements.commandCenterForecastScenarioValue.textContent = 'stale scenario';
    fixture.elements.commandCenterForecastAuthority.textContent = 'stale tenant';
    const run = controller.workspaceReady(PAID);
    expect(fixture.elements.commandCenterForecastBaselineValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterForecastScenarioValue.textContent).toBe('Not available');
    expect(renderedText(fixture.elements.commandCenterForecastAuthority)).not.toContain('stale tenant');
    expect(calls).toEqual([
      `/api/v1/forecast/deterministic-baselines/${ORIGIN}`,
      `/api/v1/forecast/calibrated-ranges/${ORIGIN}`,
      '/api/v1/forecast/named-pipeline-scenarios/current',
    ]);
    pending[0](response(bundle.baseline)); pending[1](response(bundle.range));
    pending[2](response(currentScenario())); await run;
    expect(fixture.elements.commandCenterForecastState.textContent).toBe('Range unavailable');
    expect(fixture.elements.commandCenterForecastRangeValue.textContent)
      .toBe('P10 / P50 / P90 withheld');
    expect(fixture.elements.commandCenterForecastScenarioValue.textContent).toBe('Values withheld');
    expect(renderedText(fixture.elements.commandCenterForecastScenarioDetails))
      .toMatch(/Scenario review revision 1.*Source complete as of Yes.*Source has more No/);

    expect(controller.sensitivityReady(currentSensitivity(true))).toBe(true);
    expect(fixture.elements.commandCenterForecastSensitivityState.textContent).toBe('Impossible target');
    expect(fixture.elements.commandCenterForecastSensitivityValue.textContent)
      .toBe('No in-bounds solution');
    expect(fixture.elements.commandCenterForecastSensitivityContext.textContent)
      .toMatch(/No weight was invented/);
    expect(renderedText(fixture.elements.commandCenterForecastSensitivityDetails))
      .toMatch(/Binding constraint selected_weight_upper_bound/);

    controller.workspaceLoading();
    expect(fixture.elements.commandCenterForecastSensitivityValue.textContent).toBe('Not available');
    expect(fixture.elements.commandCenterForecastEvidenceMap.children).toHaveLength(0);
    controller.workspaceUnavailable();
    expect(fixture.elements.commandCenterForecastState.textContent).toBe('Workspace unavailable');
    expect(fixture.elements.commandCenterForecastRangeValue.textContent)
      .toBe('P10 / P50 / P90 withheld');
  });

  test('refuses sensitivity from another scenario and distinguishes zero from unavailable without displaying it', async () => {
    const browser = api(); const bundle = browser.demoBundle(); const fixture = documentFixture();
    const queue = [bundle.baseline, bundle.range, currentScenario()];
    const controller = browser.create({ mode: 'paid', document: fixture.document,
      originProvider: () => ORIGIN, fetcher: async () => response(queue.shift()) });
    await controller.workspaceReady(PAID);
    const mismatch = currentSensitivity(); mismatch.scenario.reviewDigest = HASH('9');
    expect(controller.sensitivityReady(mismatch)).toBe(false);
    expect(fixture.elements.commandCenterForecastSensitivityState.textContent).toBe('Not analyzed');
    expect(renderedText(fixture.elements.commandCenterForecastSensitivityDetails))
      .not.toContain(HASH('9'));
    expect(renderedText(fixture.elements.commandCenterForecastRanges)).not.toMatch(/\b0(?:\.0+)?\b/);

    await controller.workspaceReady({ tenantId: 'other-tenant', role: 'owner', mode: 'demo',
      fictional: true });
    expect(fixture.elements.commandCenterForecastState.textContent).toBe('Workspace unavailable');
    expect(renderedText(fixture.elements.commandCenterForecastAuthority))
      .not.toContain('other-tenant');
  });
});
