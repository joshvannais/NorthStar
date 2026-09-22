'use strict';

// Mission 26 Part 4B: arithmetic over supplied, finalized frozen-cohort
// summaries. No source authentication, calibrated probability or forecast.
const { validateReportingWindow, compareReportingWindows } = require('./timeSeriesWindows');

const VERSION = 'm26-transition-rate-diagnostic-v1';
const TARGETS = new Set(['demand.qualification_transition',
  'demand.estimate_request_transition', 'demand.booking_transition',
  'demand.booking_cancellation']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_COUNT = 1000000000;

function invalid() {
  const error = new Error('Transition cohort details are invalid.');
  error.code = 'M26_TRANSITION_COHORT_INVALID';
  throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key =>
    typeof key === 'string' && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key).enumerable &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function dense(values) {
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype ||
      values.length > 52 || Reflect.ownKeys(values).length !== values.length + 1) return false;
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, index);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
      return false;
  }
  return true;
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isSafeInteger(Date.parse(value)) && new Date(value).toISOString() === value;
}
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function count(value) { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT; }
function unavailable(base, reason) {
  return Object.freeze({ ...base, state: 'unavailable', reason, observedRate: null,
    confidence: 'unavailable', sourceAuthenticated: false, forecastIssued: false });
}

function describeTransitionRate(input) {
  if (!exact(input, ['version', 'organizationId', 'targetKey', 'asOf', 'reportingWindow',
    'sourceSnapshotDigest', 'cohorts']) || input.version !== VERSION ||
      typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
      input.organizationId !== input.organizationId.toLowerCase() ||
      !TARGETS.has(input.targetKey) || !instant(input.asOf) ||
      !digest(input.sourceSnapshotDigest) || !dense(input.cohorts)) invalid();
  try { validateReportingWindow(input.reportingWindow); }
  catch (_error) { invalid(); }
  const reference = input.reportingWindow;
  if (reference.organizationId !== input.organizationId ||
      reference.serviceKey !== null || reference.areaScope !== 'tenant_all' ||
      reference.startsAt < input.asOf || reference.calendarState !== 'known') invalid();
  const leadTime = Date.parse(reference.startsAt) - Date.parse(input.asOf);

  const seen = new Set();
  const seenWindows = new Set();
  let eligible = 0n, transitioned = 0n, included = 0;
  let missing = 0, stale = 0, incomparable = 0, empty = 0;
  for (const cohort of input.cohorts) {
    if (!exact(cohort, ['targetKey', 'window', 'freezeAt', 'sourceRecordedThrough', 'cohortDigest',
      'outcomeDigest', 'state', 'eligibleCount', 'transitionedCount', 'unresolvedCount']) ||
        cohort.targetKey !== input.targetKey ||
        !instant(cohort.freezeAt) || !instant(cohort.sourceRecordedThrough) ||
        !digest(cohort.cohortDigest) ||
        !(cohort.outcomeDigest === null || digest(cohort.outcomeDigest)) ||
        !['complete', 'incomplete', 'revoked'].includes(cohort.state) ||
        !count(cohort.eligibleCount) || !count(cohort.transitionedCount) ||
        !count(cohort.unresolvedCount) ||
        cohort.transitionedCount + cohort.unresolvedCount > cohort.eligibleCount ||
        (cohort.state === 'complete' &&
          (cohort.unresolvedCount !== 0 || cohort.outcomeDigest === null))) invalid();
    try { validateReportingWindow(cohort.window); }
    catch (_error) { invalid(); }
    if (cohort.window.organizationId !== input.organizationId ||
        cohort.window.serviceKey !== null || cohort.window.areaScope !== 'tenant_all' ||
        cohort.freezeAt >= cohort.window.startsAt ||
        cohort.window.endsAt > cohort.sourceRecordedThrough ||
        cohort.sourceRecordedThrough > input.asOf ||
        seen.has(cohort.cohortDigest) || seenWindows.has(cohort.window.startsAt)) invalid();
    seen.add(cohort.cohortDigest);
    seenWindows.add(cohort.window.startsAt);
    const comparison = compareReportingWindows(reference, cohort.window);
    const cohortLeadTime = Date.parse(cohort.window.startsAt) - Date.parse(cohort.freezeAt);
    if (cohort.state === 'revoked') stale += 1;
    else if (cohort.state === 'incomplete') missing += 1;
    else if (!comparison.comparableContext || comparison.normalizationRequired ||
        cohort.window.businessProfileId !== reference.businessProfileId ||
        cohort.window.businessProfileVersion !== reference.businessProfileVersion ||
        cohort.window.businessProfileHash !== reference.businessProfileHash ||
        cohortLeadTime !== leadTime) incomparable += 1;
    else if (cohort.eligibleCount === 0) empty += 1;
    else {
      included += 1;
      eligible += BigInt(cohort.eligibleCount);
      transitioned += BigInt(cohort.transitionedCount);
    }
  }
  const base = Object.freeze({ version: VERSION, organizationId: input.organizationId,
    targetKey: input.targetKey, sourceSnapshotDigest: input.sourceSnapshotDigest,
    includedCohorts: included, missingCohorts: missing, staleCohorts: stale,
    incomparableCohorts: incomparable, emptyCohorts: empty,
    eligibleCount: eligible.toString(), transitionedCount: transitioned.toString() });
  if (stale || missing) return unavailable(base, 'incomplete_outcome_coverage');
  if (incomparable) return unavailable(base, 'incomparable_cohorts');
  if (empty) return unavailable(base, 'zero_eligible_cohort');
  if (!included) return unavailable(base, 'insufficient_history');
  const scaled = (transitioned * 1000000n + eligible / 2n) / eligible;
  const observedRate = `${scaled / 1000000n}${scaled % 1000000n === 0n ? '' :
    `.${(scaled % 1000000n).toString().padStart(6, '0').replace(/0+$/, '')}`}`;
  return Object.freeze({ ...base, state: 'descriptive_only', reason: null, observedRate,
    confidence: 'unavailable', sourceAuthenticated: false, forecastIssued: false });
}

module.exports = { VERSION, describeTransitionRate };
