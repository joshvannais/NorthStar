'use strict';

const contract = require('../../public/js/learning-center-contract');

const digest = 'a'.repeat(64);
const consent = { active: true, current: { revision: 1, digest, action: 'grant' }, history: [], total: 1, truncated: false };

describe('Mission 25 Learning Center browser contract', () => {
  test('accepts bounded paid and isolated-demo center projections', () => {
    for (const authority of ['tenant_private_postgresql', 'isolated_demo_postgresql']) {
      const value = { version: 'm25-learning-center-v2', authority, evaluatedAt: new Date().toISOString(),
        nativeLabor: consent, sources: [{ sourceKind: 'labor', sourceKey: 'crewclock.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false }],
        sourceTotal: 1, sourcesTruncated: false, learningBoundary: 'Advisory owner review remains required.' };
      expect(contract.center(value)).toBe(value);
    }
  });

  test('rejects duplicate, invalid and over-broad source projections', () => {
    const base = { version: 'm25-learning-center-v2', authority: 'tenant_private_postgresql', evaluatedAt: new Date().toISOString(),
      nativeLabor: consent, sourceTotal: 2, sourcesTruncated: false, learningBoundary: 'Advisory owner review remains required.' };
    expect(() => contract.center({ ...base, sources: [
      { sourceKind: 'labor', sourceKey: 'duplicate.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'labor', sourceKey: 'duplicate.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
    ] })).toThrow('Learning source response is invalid.');
    expect(() => contract.center({ ...base, sources: [{ sourceKind: 'travel', sourceKey: 'Invalid Source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false }] }))
      .toThrow('Learning source response is invalid.');
    expect(contract.center({ ...base, sources: [
      { sourceKind: 'labor', sourceKey: 'shared.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'travel', sourceKey: 'shared.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
    ] }).sourceTotal).toBe(2);
  });

  test('validates consent, evidence, reference and calibration detail', () => {
    expect(contract.consent(consent)).toBe(consent);
    expect(contract.source({ sourceKey: 'crewclock.demo', activeConsent: true, runs: [], runTotal: 0, runsTruncated: false,
      currentRecords: [], recordTotal: 0, recordsTruncated: false })).toBeTruthy();
    expect(contract.matches({ sourceKey: 'crewclock.demo', activeConsent: true, references: [], referenceTotal: 0,
      workerTargets: [], jobTargets: [] })).toBeTruthy();
    expect(contract.matches({ sourceKey: 'fleet.demo', activeConsent: true, references: [], referenceTotal: 0,
      vehicleTargets: [], jobTargets: [] })).toBeTruthy();
    expect(contract.consent({ current: { revision: 1, digest, action: 'grant' }, history: [], total: 1, truncated: false }).active).toBe(true);
    expect(contract.calibration({ sourceKey: 'crewclock.demo', serviceKey: 'tree-service', activeConsent: true,
      history: [], total: 0 })).toBeTruthy();
    expect(contract.operations({ sourceKey: 'fleet.demo', adapter: null, retention: null, deletion: null,
      checkpoints: [], activeRecordTotal: 0, retentionEligibleTotal: 0, deletionComplete: null,
      boundary: 'No deletion has been requested.' }).deletionComplete).toBe(false);
    expect(contract.label('tree-service')).toBe('Tree Service');
  });
});
