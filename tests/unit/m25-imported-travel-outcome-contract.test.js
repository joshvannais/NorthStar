'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../../src/learning/importedTravelOutcomeContract');
const digest = 'a'.repeat(64);

test('normalizes explicit imported-travel consent and observation inputs', () => {
  const consent = contract.normalizeConsent('fleet.primary', { action: 'grant', expectedRevision: 0,
    expectedDigest: 'none', reason: 'Use reviewed imported travel evidence.', confirmed: true,
    confirmationVersion: 'm25-imported-travel-variance-consent-v1' });
  assert.equal(consent.sourceKey, 'fleet.primary');
  const observation = contract.normalizeObservation('fleet.primary', '123e4567-e89b-42d3-a456-426614174000', {
    externalJobReference: 'job-19', expectedConsentRevision: 1, expectedConsentDigest: digest,
    reason: 'Compare the matched job with its adopted travel plan.', confirmed: true,
    confirmationVersion: 'm25-imported-travel-variance-observation-v1' });
  assert.equal(observation.estimateId, '123e4567-e89b-42d3-a456-426614174000');
});

test('rejects unconfirmed, malformed, extra and stale-shaped imported-travel input', () => {
  const base = { externalJobReference: 'job-19', expectedConsentRevision: 1, expectedConsentDigest: digest,
    reason: 'Compare the matched job.', confirmed: true,
    confirmationVersion: 'm25-imported-travel-variance-observation-v1' };
  for (const value of [{ ...base, confirmed: false }, { ...base, extra: true }, { ...base, expectedConsentRevision: 0 },
    { ...base, expectedConsentDigest: 'bad' }, { ...base, externalJobReference: 'contains space' }]) {
    assert.throws(() => contract.normalizeObservation('fleet.primary', '123e4567-e89b-42d3-a456-426614174000', value),
      error => error.code === 'M25_IMPORTED_TRAVEL_OUTCOME_INPUT_INVALID');
  }
  assert.throws(() => contract.normalizeEstimateId('not-a-uuid'),
    error => error.code === 'M25_IMPORTED_TRAVEL_OUTCOME_INPUT_INVALID');
});
