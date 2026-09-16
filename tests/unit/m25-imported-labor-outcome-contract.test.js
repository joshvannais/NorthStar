'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../../src/learning/importedLaborOutcomeContract');
const digest = 'a'.repeat(64);

test('normalizes explicit imported-labor consent and observation inputs', () => {
  const consent = contract.normalizeConsent('payroll.primary', { action: 'grant', expectedRevision: 0,
    expectedDigest: 'none', reason: 'Use reviewed imported labor evidence.', confirmed: true,
    confirmationVersion: 'm25-imported-labor-duration-consent-v1' });
  assert.equal(consent.sourceKey, 'payroll.primary');
  const observation = contract.normalizeObservation('payroll.primary', '123e4567-e89b-42d3-a456-426614174000', {
    externalJobReference: 'job-19', expectedConsentRevision: 1, expectedConsentDigest: digest,
    reason: 'Compare the matched job with its adopted plan.', confirmed: true,
    confirmationVersion: 'm25-imported-labor-duration-observation-v1' });
  assert.equal(observation.estimateId, '123e4567-e89b-42d3-a456-426614174000');
});

test('rejects unconfirmed, malformed, extra and stale-shaped input', () => {
  const base = { externalJobReference: 'job-19', expectedConsentRevision: 1, expectedConsentDigest: digest,
    reason: 'Compare the matched job.', confirmed: true,
    confirmationVersion: 'm25-imported-labor-duration-observation-v1' };
  for (const value of [{ ...base, confirmed: false }, { ...base, extra: true }, { ...base, expectedConsentRevision: 0 },
    { ...base, expectedConsentDigest: 'bad' }, { ...base, externalJobReference: 'contains space' }]) {
    assert.throws(() => contract.normalizeObservation('payroll.primary', '123e4567-e89b-42d3-a456-426614174000', value),
      error => error.code === 'M25_IMPORTED_OUTCOME_INPUT_INVALID');
  }
  assert.throws(() => contract.normalizeEstimateId('not-a-uuid'), error => error.code === 'M25_IMPORTED_OUTCOME_INPUT_INVALID');
});
