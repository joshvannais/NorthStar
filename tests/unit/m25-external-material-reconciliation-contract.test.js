'use strict';
const { normalizeMatch } = require('../../src/learning/externalMaterialReconciliationContract');
const digest = 'a'.repeat(64);
const valid = { action: 'link', referenceKind: 'material', externalReference: 'material-cedar', targetReference: 'cedar-boards', expectedRevision: 0, expectedDigest: 'none', expectedSourceDigest: digest, expectedTargetDigest: digest, reason: 'Link the exact reviewed records.', confirmed: true, confirmationVersion: 'm25-external-material-reference-match-v1' };
describe('external material reconciliation contract', () => {
  test('accepts exact job, material, vendor and inventory location links', () => {
    for (const referenceKind of ['job', 'material', 'vendor', 'inventory_location']) expect(normalizeMatch('materials.primary', { ...valid, referenceKind }).referenceKind).toBe(referenceKind);
  });
  test('accepts an exact unlink and rejects fuzzy or incomplete requests', () => {
    expect(normalizeMatch('materials.primary', { ...valid, action: 'unlink', targetReference: null, expectedTargetDigest: 'unavailable' }).action).toBe('unlink');
    for (const body of [{ ...valid, targetReference: ' cedar-boards' }, { ...valid, expectedSourceDigest: 'unavailable' }, { ...valid, referenceKind: 'supplier' }, { ...valid, extra: true }]) expect(() => normalizeMatch('materials.primary', body)).toThrow(/invalid/i);
  });
});
