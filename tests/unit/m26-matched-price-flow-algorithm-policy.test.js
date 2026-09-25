'use strict';

const { assessMatchedPriceFlowAlgorithms } =
  require('../../src/forecasting/matchedPriceFlowAlgorithmPolicy');

function population(actualAmount) {
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  const items = Array.from({ length: 60 }, (_unused, index) => ({
    state: 'matched_algorithms_observed', actualPairStatus: 'paired',
    horizonStart: new Date(start + index * 86400000).toISOString(),
    horizonEnd: new Date(start + (index + 1) * 86400000).toISOString(),
    baseOutput: { calculationVersion: 'm26_price_flow_carry_forward_v1',
      unit: { currency: 'USD' }, value: { amount: '100.00' } },
    candidateOutput: { calculationVersion: 'm26_price_flow_zero_baseline_v1',
      unit: { currency: 'USD' }, value: { amount: '0.00' } },
    baseActual: { state: 'pair_actual_known', amount: actualAmount,
      sourceDigest: 'a'.repeat(64),
      observedThrough:
        new Date(start + (index + 2) * 86400000).toISOString() },
    candidateActual: { state: 'pair_actual_known', amount: actualAmount,
      sourceDigest: 'a'.repeat(64),
      observedThrough:
        new Date(start + (index + 2) * 86400000).toISOString() },
  }));
  return { state: 'matched_population_observed',
    scope: 'northstar_m24_registered_saved_algorithms_only',
    expectedUtcDays: 60, windowStart: new Date(start).toISOString(),
    windowEnd: new Date(start + 60 * 86400000).toISOString(),
    storedBaseCount: 60, matchingBaseCount: 60, excludedBaseCount: 0,
    candidateMissingCount: 0, candidateDuplicateCount: 0,
    orphanCandidateCount: 0, missingSavedOriginDays: 0,
    duplicateSavedOriginDays: 0, pairedCount: 60, partialCount: 0,
    missingActualCount: 0, unavailableCount: 0,
    distinctSourceEventDays: 0, sourceEventDiversityVerified: false,
    completeRegisteredPopulation: true, items };
}

describe('M26 Part 3D private matched algorithm policy', () => {
  test('compares exactly sixty same-source outcomes without authorizing promotion', () => {
    const baselineBetter = assessMatchedPriceFlowAlgorithms(
      population('0.00'));
    expect(baselineBetter).toMatchObject({
      state: 'descriptive_comparison_only',
      direction: 'candidate_lower_error',
      referenceDirection: 'candidate_lower_error',
      laterDirection: 'candidate_lower_error',
      candidateWorseDays: 0, numericalErrorAvailable: false,
      sourceEventDiversityVerified: false,
      observationLag: { state: 'descriptive_only',
        maximumObservedUtcDays: 1,
        actualCommitLagVerified: false },
      humanReviewAvailable: false, promotionAvailable: false,
      realForecastEligible: false });
    const currentBetter = assessMatchedPriceFlowAlgorithms(
      population('100.00'));
    expect(currentBetter).toMatchObject({
      direction: 'candidate_higher_error', candidateWorseDays: 60,
      promotionAvailable: false });
  });

  test('only a source-verified sixty-event population carries diversity evidence', () => {
    const verified = population('0.00');
    verified.distinctSourceEventDays = 60;
    verified.sourceEventDiversityVerified = true;
    expect(assessMatchedPriceFlowAlgorithms(verified)).toMatchObject({
      state: 'descriptive_comparison_only',
      sourceEventDiversityVerified: true,
      promotionAvailable: false });
    verified.distinctSourceEventDays = 59;
    expect(() => assessMatchedPriceFlowAlgorithms(verified)).toThrow(
      'Matched algorithm population is invalid.');
  });

  test('late outcome observation remains unavailable for review', () => {
    const late = population('0.00');
    late.items[0].baseActual.observedThrough =
      new Date(Date.parse(late.items[0].horizonEnd) +
        61 * 86400000).toISOString();
    late.items[0].candidateActual.observedThrough =
      late.items[0].baseActual.observedThrough;
    expect(assessMatchedPriceFlowAlgorithms(late)).toMatchObject({
      observationLag: { state: 'unavailable',
        reason: 'source_observation_lag_unverified' },
      promotionAvailable: false });
  });

  test('missing origins fail closed and duplicate days cannot be scored', () => {
    const incomplete = population('0.00');
    incomplete.items.pop();
    incomplete.storedBaseCount = 59;
    incomplete.matchingBaseCount = 59;
    incomplete.pairedCount = 59;
    incomplete.missingSavedOriginDays = 1;
    incomplete.completeRegisteredPopulation = false;
    expect(assessMatchedPriceFlowAlgorithms(incomplete)).toMatchObject({
      state: 'comparison_unavailable',
      reason: 'matched_population_incomplete',
      promotionAvailable: false });
    const duplicate = population('0.00');
    duplicate.items[1].horizonStart = duplicate.items[0].horizonStart;
    expect(() => assessMatchedPriceFlowAlgorithms(duplicate)).toThrow(
      'Matched algorithm population is invalid.');
  });
});
