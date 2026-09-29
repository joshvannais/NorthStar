'use strict';

const { validateReportingWindow } = require('./timeSeriesWindows');
const { assessOrderedPriceReportingMonthCandidate } =
  require('./orderedPriceMonthCandidate');

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;

function unavailable(reason) {
  return Object.freeze({ state: 'unavailable', reason,
    observationCoverageVerified: false,
    historicalCalendarVerified: false,
    eligibleForForecast: false, wholeBusinessCoverageVerified: false,
    forecastIssued: false });
}

function sameInstant(sqlInstant, jsInstant) {
  return typeof sqlInstant === 'string' && INSTANT.test(sqlInstant) &&
    Number.isFinite(Date.parse(sqlInstant)) &&
    Date.parse(sqlInstant) === Date.parse(jsInstant);
}

function sourceEventCurrencyConsistent(source, windows, currency) {
  if (!Array.isArray(source?.snapshot?.events)) return false;
  return source.snapshot.events.every(event => {
    const observedAt = event?.sourceObservedAt;
    if (typeof observedAt !== 'string' || !INSTANT.test(observedAt)) return false;
    const inSelectedPeriod = windows.some(window =>
      Date.parse(observedAt) >= Date.parse(window.startsAt) &&
      Date.parse(observedAt) < Date.parse(window.endsAt));
    return !inSelectedPeriod || event.currency === currency;
  });
}

function assessComparablePricePeriods({ source, profileProofs,
  priceActivation, windows, currency, anchorId }) {
  if (!Array.isArray(windows) || windows.length !== 2 ||
      !Array.isArray(profileProofs) || profileProofs.length !== 2 ||
      typeof currency !== 'string' || !CURRENCY.test(currency) ||
      typeof anchorId !== 'string') {
    return unavailable('invalid_comparison_request');
  }
  try { windows.forEach(validateReportingWindow); }
  catch { return unavailable('invalid_reporting_window'); }
  const [first, second] = windows;
  if (first.grain !== 'month' || second.grain !== 'month' ||
      first.serviceKey !== null || second.serviceKey !== null ||
      first.areaScope !== 'tenant_all' || second.areaScope !== 'tenant_all' ||
      first.organizationId !== second.organizationId ||
      first.businessProfileId !== second.businessProfileId ||
      first.businessProfileVersion !== second.businessProfileVersion ||
      first.businessProfileHash !== second.businessProfileHash ||
      first.timeZone !== second.timeZone ||
      first.areaDigest !== second.areaDigest ||
      first.calendarDigest !== second.calendarDigest ||
      first.calendarState !== second.calendarState ||
      first.calendarState !== 'known' ||
      first.endsAt > second.startsAt) {
    return unavailable('incomparable_profile_periods');
  }
  for (let i = 0; i < 2; i += 1) {
    const proof = profileProofs[i];
    const window = windows[i];
    if (!proof || proof.state !== 'profile_effective_window_verified' ||
        proof.anchorId !== anchorId ||
        proof.businessProfileId !== window.businessProfileId ||
        proof.businessProfileVersion !== window.businessProfileVersion ||
        proof.businessProfileHash !== window.businessProfileHash ||
        proof.historicalCalendarVerified !== true ||
        proof.observationCoverageVerified !== false ||
        !sameInstant(proof.startsAt, window.startsAt) ||
        !sameInstant(proof.endsAt, window.endsAt)) {
      return unavailable('profile_period_unverified');
    }
  }
  if (!source || !priceActivation ||
      priceActivation.state !== 'price_anchor_activation_recorded' ||
      priceActivation.firstReceiptId !== source.firstReceiptId ||
      !INSTANT.test(priceActivation.observedAt || '') ||
      !Number.isFinite(Date.parse(priceActivation.observedAt)) ||
      Date.parse(priceActivation.observedAt) >= Date.parse(first.startsAt)) {
    return unavailable('price_source_period_unverified');
  }
  if (!sourceEventCurrencyConsistent(source, windows, currency)) {
    return unavailable('currency_mismatch');
  }
  const candidates = windows.map(window =>
    assessOrderedPriceReportingMonthCandidate(source, window, currency));
  if (candidates.some(candidate => candidate.candidateWindowChecksPassed !== true)) {
    return unavailable(candidates.find(candidate =>
      candidate.candidateWindowChecksPassed !== true)?.reason ||
      'price_source_period_unverified');
  }
  if (candidates.some(candidate => !DIGEST.test(candidate.sourceSnapshotDigest || '')) ||
      candidates[0].sourceSnapshotDigest !== candidates[1].sourceSnapshotDigest) {
    return unavailable('source_snapshot_mismatch');
  }
  // Insert-time source ordering is not commit-time month-end visibility.
  // These are retrospectively known cohorts as of the current receipt, and
  // a later committed in-period decision can change the next receipt.
  return Object.freeze({ state: 'comparable_supported_source_cohorts_at_capture',
    reason: null, sourceScope: 'northstar_m24_approved_price_decisions',
    sourceSnapshotId: candidates[0].sourceSnapshotId,
    sourceSnapshotDigest: candidates[0].sourceSnapshotDigest,
    currency, periods: Object.freeze(candidates.map((candidate, index) =>
      Object.freeze({ window: Object.freeze({ ...windows[index] }),
        sourceInsertTimeDecisionCountKnownAtCapture:
          candidate.inputOrderTimestampDecisionCount,
        zeroDecisionsKnownAtCapture:
          candidate.inputOrderTimestampDecisionCount === 0 }))),
    sourceCohortAsOfCaptureVerified: true,
    observationCoverageVerified: false,
    historicalCalendarVerified: true,
    eligibleForForecast: false, wholeBusinessCoverageVerified: false,
    forecastIssued: false });
}

module.exports = { assessComparablePricePeriods };
