'use strict';
const contract = require('../../src/learning/externalTravelReconciliationContract');
const digest = 'a'.repeat(64);
const body = () => ({ action: 'link', referenceKind: 'vehicle', externalReference: 'truck-2', targetId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, expectedDigest: 'none', expectedSourceDigest: digest, expectedTargetDigest: digest, reason: 'Owner matched the exact current reviewed vehicle.', confirmed: true, confirmationVersion: 'm25-external-travel-reference-match-v1' });
describe('Mission 25 external travel reconciliation contract', () => {
  test('accepts explicit reviewed job or vehicle links', () => { expect(contract.normalizeMatch('fleet.primary', body()).referenceKind).toBe('vehicle'); const value = body(); value.referenceKind = 'job'; expect(contract.normalizeMatch('fleet.primary', value).referenceKind).toBe('job'); });
  test('requires complete current digests and exact fields', () => { for (const change of [v => { v.expectedSourceDigest = 'unavailable'; }, v => { v.expectedTargetDigest = null; }, v => { v.extra = true; }, v => { v.referenceKind = 'worker'; }]) { const value = body(); change(value); expect(() => contract.normalizeMatch('fleet.primary', value)).toThrow(); } });
  test('supports explicit unlink without retaining a target', () => { const value = body(); Object.assign(value, { action: 'unlink', targetId: null, expectedRevision: 1, expectedDigest: digest, expectedSourceDigest: digest, expectedTargetDigest: 'unavailable' }); expect(contract.normalizeMatch('fleet.primary', value).targetId).toBeNull(); });
});
