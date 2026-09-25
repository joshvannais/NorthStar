'use strict';

// A private deterministic comparison of two registered selected-M24 point
// versions on exactly the same saved origins and source-owned actuals. It
// does not certify unsaved days, external business coverage or real fitness.
const VERSION = 'm26-matched-price-flow-policy-v1';
const AMOUNT = /^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/;
const DAY = 86400000;

function invalid() {
  const error = new Error('Matched algorithm population is invalid.');
  error.code = 'M26_MATCHED_ALGORITHM_INVALID';
  throw error;
}

function cents(value) {
  if (typeof value !== 'string' || !AMOUNT.test(value)) invalid();
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}

function abs(value) { return value < 0n ? -value : value; }

function assessMatchedPriceFlowAlgorithms(population) {
  if (!population || population.state !== 'matched_population_observed' ||
      population.scope !== 'northstar_m24_registered_saved_algorithms_only' ||
      population.expectedUtcDays !== 60 ||
      !Array.isArray(population.items) || population.items.length > 100 ||
      population.matchingBaseCount !== population.items.length ||
      population.matchingBaseCount + population.excludedBaseCount !==
        population.storedBaseCount) invalid();
  const counts = {
    expectedUtcDays: 60,
    storedBaseCount: population.storedBaseCount,
    matchingBaseCount: population.matchingBaseCount,
    excludedBaseCount: population.excludedBaseCount,
    candidateMissingCount: population.candidateMissingCount,
    candidateDuplicateCount: population.candidateDuplicateCount,
    orphanCandidateCount: population.orphanCandidateCount,
    missingSavedOriginDays: population.missingSavedOriginDays,
    duplicateSavedOriginDays: population.duplicateSavedOriginDays,
    pairedCount: population.pairedCount,
    partialCount: population.partialCount,
    missingActualCount: population.missingActualCount,
    unavailableCount: population.unavailableCount,
    distinctSourceEventDays: population.distinctSourceEventDays,
  };
  if (!Object.values(counts).every(Number.isInteger) ||
      Object.values(counts).some(value => value < 0 || value > 100)) invalid();
  const complete = population.completeRegisteredPopulation === true &&
    counts.storedBaseCount === 60 && counts.matchingBaseCount === 60 &&
    counts.excludedBaseCount === 0 && counts.candidateMissingCount === 0 &&
    counts.candidateDuplicateCount === 0 && counts.orphanCandidateCount === 0 &&
    counts.missingSavedOriginDays === 0 &&
    counts.duplicateSavedOriginDays === 0 && counts.pairedCount === 60 &&
    counts.partialCount === 0 && counts.missingActualCount === 0 &&
    counts.unavailableCount === 0;
  if (population.sourceEventDiversityVerified !==
      (counts.matchingBaseCount === 60 &&
       counts.distinctSourceEventDays === 60)) invalid();
  if (!complete) return Object.freeze({ version: VERSION,
    state: 'comparison_unavailable', reason: 'matched_population_incomplete',
    counts: Object.freeze(counts), numericalErrorAvailable: false,
    humanReviewAvailable: false, promotionAvailable: false,
    realForecastEligible: false });
  const start = Date.parse(population.windowStart);
  const end = Date.parse(population.windowEnd);
  if (!Number.isFinite(start) || end - start !== 60 * DAY) invalid();
  const days = new Set();
  let maximumObservationLag = 0;
  let observationLagProven = true;
  const halves = [{ currentAbsolute: 0n, candidateAbsolute: 0n,
    currentSigned: 0n, candidateSigned: 0n, candidateWorseDays: 0 },
  { currentAbsolute: 0n, candidateAbsolute: 0n,
    currentSigned: 0n, candidateSigned: 0n, candidateWorseDays: 0 }];
  for (const item of population.items) {
    if (item?.state !== 'matched_algorithms_observed' ||
        item.actualPairStatus !== 'paired' ||
        item.baseOutput?.calculationVersion !==
          'm26_price_flow_carry_forward_v1' ||
        item.candidateOutput?.calculationVersion !==
          'm26_price_flow_zero_baseline_v1' ||
        item.baseActual?.state !== 'pair_actual_known' ||
        item.candidateActual?.state !== 'pair_actual_known' ||
        item.baseActual.amount !== item.candidateActual.amount ||
        item.baseActual.sourceDigest !== item.candidateActual.sourceDigest ||
        item.baseOutput?.unit?.currency !==
          item.candidateOutput?.unit?.currency) invalid();
    const time = Date.parse(item.horizonStart);
    const index = (time - start) / DAY;
    if (!Number.isInteger(index) || index < 0 || index >= 60 ||
        days.has(index)) invalid();
    days.add(index);
    const horizonEnd = Date.parse(item.horizonEnd);
    const observedThrough = Date.parse(item.baseActual.observedThrough);
    if (!Number.isFinite(horizonEnd) ||
        horizonEnd !== time + DAY ||
        !Number.isFinite(observedThrough) ||
        observedThrough < horizonEnd ||
        item.baseActual.observedThrough !==
          item.candidateActual.observedThrough) {
      observationLagProven = false;
    } else {
      maximumObservationLag = Math.max(maximumObservationLag,
        observedThrough - horizonEnd);
    }
    const actual = cents(item.baseActual.amount);
    const currentError = cents(item.baseOutput.value.amount) - actual;
    const candidateError = cents(item.candidateOutput.value.amount) - actual;
    const half = halves[index < 30 ? 0 : 1];
    half.currentAbsolute += abs(currentError);
    half.candidateAbsolute += abs(candidateError);
    half.currentSigned += currentError;
    half.candidateSigned += candidateError;
    if (abs(candidateError) > abs(currentError)) half.candidateWorseDays += 1;
  }
  if (days.size !== 60) invalid();
  const currentAbsolute = halves[0].currentAbsolute + halves[1].currentAbsolute;
  const candidateAbsolute = halves[0].candidateAbsolute +
    halves[1].candidateAbsolute;
  const direction = candidateAbsolute < currentAbsolute ?
    'candidate_lower_error' : candidateAbsolute > currentAbsolute ?
      'candidate_higher_error' : 'equal_absolute_error';
  const summary = Object.freeze({ version: VERSION,
    state: 'descriptive_comparison_only', counts: Object.freeze(counts),
    direction, referenceDirection:
      halves[0].candidateAbsolute < halves[0].currentAbsolute ?
        'candidate_lower_error' :
        halves[0].candidateAbsolute > halves[0].currentAbsolute ?
          'candidate_higher_error' : 'equal_absolute_error',
    laterDirection:
      halves[1].candidateAbsolute < halves[1].currentAbsolute ?
        'candidate_lower_error' :
        halves[1].candidateAbsolute > halves[1].currentAbsolute ?
          'candidate_higher_error' : 'equal_absolute_error',
    candidateWorseDays: halves[0].candidateWorseDays +
      halves[1].candidateWorseDays,
    numericalErrorAvailable: false,
    sourceEventDiversityVerified:
      population.sourceEventDiversityVerified === true,
    observationLag: Object.freeze(
      observationLagProven && maximumObservationLag <= 60 * DAY ?
        { state: 'descriptive_only', policyMaxUtcDays: 60,
          maximumObservedUtcDays:
            Math.ceil(maximumObservationLag / DAY),
          actualCommitLagVerified: false } :
        { state: 'unavailable',
          reason: 'source_observation_lag_unverified' }),
    humanReviewAvailable: false, promotionAvailable: false,
    realForecastEligible: false });
  return summary;
}

module.exports = { VERSION, assessMatchedPriceFlowAlgorithms };
