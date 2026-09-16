'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeMatch } = require('../../src/learning/externalLaborReconciliationContract');
const digest = 'a'.repeat(64);
const base = { referenceKind: 'worker', externalReference: 'worker-7', action: 'link',
  targetId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, expectedDigest: 'none',
  expectedSourceDigest: digest, expectedTargetDigest: digest, reason: 'Reviewed against the current worker roster.',
  confirmed: true, confirmationVersion: 'm25-external-labor-reference-match-v1' };

test('normalizes reviewed worker and job links and explicit unlink', () => {
  assert.equal(normalizeMatch('payroll.primary', base).externalReference, 'worker-7');
  assert.equal(normalizeMatch('payroll.primary', { ...base, referenceKind: 'job' }).referenceKind, 'job');
  const unlink = normalizeMatch('payroll.primary', { ...base, action: 'unlink', targetId: null,
    expectedRevision: 1, expectedDigest: digest, expectedTargetDigest: 'unavailable' });
  assert.equal(unlink.action, 'unlink');
});

test('rejects inferred, unconfirmed, stale-shaped and excess match input', () => {
  for (const body of [
    { ...base, confirmed: false }, { ...base, targetId: null }, { ...base, expectedSourceDigest: 'unavailable' },
    { ...base, expectedRevision: 0, expectedDigest: digest }, { ...base, expectedTargetDigest: null },
    { ...base, surprise: true }, { ...base, externalReference: ' spaced ' },
  ]) assert.throws(() => normalizeMatch('payroll.primary', body), /invalid/i);
});
