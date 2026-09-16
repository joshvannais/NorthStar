'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../../src/learning/importedLaborCalibrationContract');
const digest = 'a'.repeat(64);

test('normalizes explicit calibration consent and proposal inputs', () => {
  const consent = contract.normalizeConsent('payroll.primary', { action: 'grant', expectedRevision: 0,
    expectedDigest: 'none', reason: 'Use reviewed imported labor outcomes.', confirmed: true,
    confirmationVersion: 'm25-imported-labor-calibration-consent-v1' });
  assert.equal(consent.sourceKey, 'payroll.primary');
  const proposal = contract.normalizeProposal('payroll.primary', 'tree_service', { expectedConsentRevision: 1,
    expectedConsentDigest: digest, reason: 'Review five current outcomes.', confirmed: true,
    confirmationVersion: 'm25-imported-labor-calibration-proposal-v1' });
  assert.equal(proposal.serviceKey, 'tree_service');
});

test('rejects malformed, extra, unconfirmed and stale-shaped input', () => {
  const base = { expectedConsentRevision: 1, expectedConsentDigest: digest, reason: 'Review outcomes.', confirmed: true,
    confirmationVersion: 'm25-imported-labor-calibration-proposal-v1' };
  for (const value of [{ ...base, confirmed: false }, { ...base, extra: true }, { ...base, expectedConsentRevision: 0 },
    { ...base, expectedConsentDigest: 'bad' }]) assert.throws(
    () => contract.normalizeProposal('payroll.primary', 'tree_service', value),
    error => error.code === 'M25_IMPORTED_CALIBRATION_INPUT_INVALID');
  assert.throws(() => contract.normalizeServiceKey('Tree Service'),
    error => error.code === 'M25_IMPORTED_CALIBRATION_INPUT_INVALID');
});
