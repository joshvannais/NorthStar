'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../../src/learning/laborOutcomeContract');

const digest = 'a'.repeat(64);
const estimateId = '11111111-1111-4111-8111-111111111111';

test('normalizes explicit consent and observation contracts', () => {
  assert.deepEqual(contract.normalizeConsent({
    action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use completed work for this comparison.',
    confirmed: true, confirmationVersion: 'm25-labor-duration-consent-v1',
  }), {
    action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use completed work for this comparison.',
    confirmed: true, confirmationVersion: 'm25-labor-duration-consent-v1',
  });
  assert.deepEqual(contract.normalizeObservation(estimateId, {
    expectedConsentRevision: 1, expectedConsentDigest: digest, reason: 'Compare the accepted records.',
    confirmed: true, confirmationVersion: 'm25-labor-duration-observation-v1',
  }), {
    estimateId, expectedConsentRevision: 1, expectedConsentDigest: digest,
    reason: 'Compare the accepted records.',
  });
});

test('rejects implicit consent, extra fields, stale sentinels and invalid identities', () => {
  const consent = { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use completed work.',
    confirmed: true, confirmationVersion: 'm25-labor-duration-consent-v1' };
  const observation = { expectedConsentRevision: 1, expectedConsentDigest: digest, reason: 'Compare accepted records.',
    confirmed: true, confirmationVersion: 'm25-labor-duration-observation-v1' };
  for (const input of [
    { ...consent, confirmed: false }, { ...consent, unexpected: true }, { ...consent, reason: ' padded ' },
    { ...consent, expectedRevision: 1, expectedDigest: 'none' },
  ]) assert.throws(() => contract.normalizeConsent(input), error => error.code === 'M25_LEARNING_INPUT_INVALID');
  for (const [id, input] of [
    ['not-an-estimate', observation], [estimateId, { ...observation, expectedConsentRevision: 0 }],
    [estimateId, { ...observation, unexpected: true }], [estimateId, { ...observation, expectedConsentDigest: 'none' }],
  ]) assert.throws(() => contract.normalizeObservation(id, input), error => error.code === 'M25_LEARNING_INPUT_INVALID');
});
