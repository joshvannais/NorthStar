'use strict';

const contract = require('../../public/js/learning-center-contract');

const digest = 'a'.repeat(64);
const consent = { active: true, current: { revision: 1, digest, action: 'grant' }, history: [], total: 1, truncated: false };

describe('Mission 25 Learning Center browser contract', () => {
  test('accepts bounded paid and isolated-demo center projections', () => {
    for (const authority of ['tenant_private_postgresql', 'isolated_demo_postgresql']) {
      const value = { version: 'm25-learning-center-v3', authority, evaluatedAt: new Date().toISOString(),
        nativeLabor: consent, nativeEquipment: consent, sources: [{ sourceKind: 'labor', sourceKey: 'crewclock.demo', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false }],
        sourceTotal: 1, sourcesTruncated: false, learningBoundary: 'Advisory owner review remains required.' };
      expect(contract.center(value)).toBe(value);
    }
    const material = { version: 'm25-learning-center-v4', authority: 'tenant_private_postgresql', evaluatedAt: new Date().toISOString(),
      nativeLabor: consent, nativeEquipment: consent, nativeMaterial: consent,
      sources: [{ sourceKind: 'material', sourceKey: 'materials.primary', serviceKeys: ['tree-service'], serviceTotal: 1, servicesTruncated: false }],
      sourceTotal: 1, sourcesTruncated: false, learningBoundary: 'Advisory owner review remains required.' };
    expect(contract.center(material)).toBe(material);
  });

  test('rejects duplicate, invalid and over-broad source projections', () => {
    const base = { version: 'm25-learning-center-v3', authority: 'tenant_private_postgresql', evaluatedAt: new Date().toISOString(),
      nativeLabor: consent, nativeEquipment: consent, sourceTotal: 2, sourcesTruncated: false, learningBoundary: 'Advisory owner review remains required.' };
    expect(() => contract.center({ ...base, sources: [
      { sourceKind: 'labor', sourceKey: 'duplicate.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'labor', sourceKey: 'duplicate.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
    ] })).toThrow('Learning source response is invalid.');
    expect(() => contract.center({ ...base, sources: [{ sourceKind: 'travel', sourceKey: 'Invalid Source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false }] }))
      .toThrow('Learning source response is invalid.');
    expect(contract.center({ ...base, sources: [
      { sourceKind: 'labor', sourceKey: 'shared.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
      { sourceKind: 'asset', sourceKey: 'shared.source', serviceKeys: [], serviceTotal: 0, servicesTruncated: false },
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
    expect(contract.matches({ sourceKey: 'equipment.demo', activeConsent: true, references: [], referenceTotal: 0,
      vehicleTargets: [], equipmentTargets: [], jobTargets: [] })).toBeTruthy();
    expect(contract.matches({ sourceKey: 'materials.demo', activeConsent: true, references: [], referenceTotal: 0,
      materialTargets: [], vendorTargets: [], inventoryLocationTargets: [], jobTargets: [] })).toBeTruthy();
    expect(contract.consent({ current: { revision: 1, digest, action: 'grant' }, history: [], total: 1, truncated: false }).active).toBe(true);
    expect(contract.consent({ current: null, crmSourceKey: 'crm.primary', communicationSourceKey: 'messages.primary',
      sourcePermissionsAvailable: true, consumptionBoundary: 'Customer outcome learning records advice only.' })).toEqual(expect.objectContaining({
        active: false, current: null, history: [], total: 0, truncated: false,
      }));
    expect(contract.consent({ current: { revision:1, digest, action:'grant', sourcePermissionsCurrent:true }, crmSourceKey:'crm.primary',
      communicationSourceKey:'messages.primary', sourcePermissionsAvailable:true })).toEqual(expect.objectContaining({ active:true, total:1 }));
    expect(contract.consent({ current: { revision:1, digest, action:'grant', sourcePermissionsCurrent:false }, crmSourceKey:'crm.primary',
      communicationSourceKey:'messages.primary', sourcePermissionsAvailable:true })).toEqual(expect.objectContaining({ active:false }));
    expect(contract.consent({ current: null, crmSourceKey: 'Invalid source', communicationSourceKey: 'messages.primary',
      sourcePermissionsAvailable: true })).toBeNull();
    expect(contract.calibration({ sourceKey: 'crewclock.demo', serviceKey: 'tree-service', activeConsent: true,
      history: [], total: 0 })).toBeTruthy();
    expect(contract.health({ sourceKey: 'equipment.demo', activeConsent: true, history: [], total: 1,
      current: { fresh: true, advisoryAvailable: true, outcomes: {
        maintenance: { status: 'recorded' }, downtime: { status: 'recorded' },
        condition: { status: 'unavailable' }, availability: { status: 'unavailable' },
      } } })).toBeTruthy();
    expect(() => contract.health({ sourceKey: 'equipment.demo', activeConsent: true, history: [], total: 1,
      current: { fresh: true, advisoryAvailable: true, outcomes: { maintenance: { status: 'recorded' } } } }))
      .toThrow('Asset health detail is invalid.');
    expect(contract.operations({ sourceKey: 'fleet.demo', adapter: null, retention: null, deletion: null,
      checkpoints: [], activeRecordTotal: 0, retentionEligibleTotal: 0, deletionComplete: null,
      boundary: 'No deletion has been requested.' }).deletionComplete).toBe(false);
    expect(contract.label('tree-service')).toBe('Tree Service');
    expect(contract.label('123e4567-e89b-42d3-a456-426614174000', 'Job')).toBe('Job');
    expect(contract.label('Truck 123e4567-e89b-42d3-a456-426614174000', 'Vehicle')).toBe('Vehicle');
    expect(contract.label({ private: true }, 'Equipment')).toBe('Equipment');
    for (const value of ['Prefix [object:Object] suffix', 'Crew object_object · Technician',
      'Crew 860/555/1212 East', 'Crew 860\u2011555\u20111212 East', 'Crew DB id: 123456789',
      'Crew 01890f47-2b7c-7cc1-98f1-426614174000', `Crew ${'a'.repeat(64)} · Technician`,
      `Crew hash:${'b'.repeat(64)} · Technician`]) {
      expect(contract.safeLabel(value)).toBeNull();
      expect(contract.label(value, 'Worker')).toBe('Worker');
    }
    expect(contract.normalizeLabel('  Ｒｅｇｉｏｎａｌ．Ｎｏｒｔｈ  ')).toBe('Regional.North');
    expect(contract.safeLabel('Regional.North')).toBe('Regional.North');
    expect(contract.safeLabel('Regional-North')).toBe('Regional-North');
    expect(contract.safeLabel('Hash Tree Service · Technician')).toBe('Hash Tree Service · Technician');
    expect(contract.safeLabel('Route 64 Crew · Technician')).toBe('Route 64 Crew · Technician');
    expect(contract.safeLabel('Chip Truck · Ford F-550')).toBe('Chip Truck · Ford F-550');
  });
});
