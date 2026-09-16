'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../../src/learning/importedTravelCalibrationContract');

const digest = 'a'.repeat(64);

test('normalizes explicit imported travel calibration consent and proposal inputs', () => {
  const consent = contract.normalizeConsent('fleet.primary', {
    action: 'grant',
    expectedRevision: 0,
    expectedDigest: 'none',
    reason: 'Use reviewed imported travel outcomes.',
    confirmed: true,
    confirmationVersion: 'm25-imported-travel-calibration-consent-v1',
  });
  assert.equal(consent.sourceKey, 'fleet.primary');

  const proposal = contract.normalizeProposal('fleet.primary', 'tree_service', {
    expectedConsentRevision: 1,
    expectedConsentDigest: digest,
    reason: 'Review five current travel outcomes.',
    confirmed: true,
    confirmationVersion: 'm25-imported-travel-calibration-proposal-v1',
  });
  assert.equal(proposal.serviceKey, 'tree_service');
});

test('rejects malformed, extra, unconfirmed and stale-shaped imported travel calibration input', () => {
  const base = {
    expectedConsentRevision: 1,
    expectedConsentDigest: digest,
    reason: 'Review travel outcomes.',
    confirmed: true,
    confirmationVersion: 'm25-imported-travel-calibration-proposal-v1',
  };
  for (const value of [
    { ...base, confirmed: false },
    { ...base, extra: true },
    { ...base, expectedConsentRevision: 0 },
    { ...base, expectedConsentDigest: 'bad' },
  ]) {
    assert.throws(() => contract.normalizeProposal('fleet.primary', 'tree_service', value),
      error => error.code === 'M25_IMPORTED_TRAVEL_CALIBRATION_INPUT_INVALID');
  }
  assert.throws(() => contract.normalizeServiceKey('Tree Service'),
    error => error.code === 'M25_IMPORTED_TRAVEL_CALIBRATION_INPUT_INVALID');
});
