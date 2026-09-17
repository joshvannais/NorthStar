'use strict';

const { applyTargetLabels, safeDisplayLabel } = require('../../src/learning/reconciliationTargetLabels');

describe('Mission 25 reconciliation target labels', () => {
  test('attaches only authoritative safe labels and removes ambiguous targets', () => {
    const matches = {
      workerTargets: [{ targetId: 'worker-a', operationalRole: 'technician', digest: 'a'.repeat(64) },
        { targetId: 'worker-b', operationalRole: 'technician', digest: 'b'.repeat(64) }],
      jobTargets: [{ targetId: 'job-a', digest: 'c'.repeat(64) }],
      vehicleTargets: [{ targetId: 'vehicle-a', digest: 'd'.repeat(64) }],
      equipmentTargets: [],
    };
    const result = applyTargetLabels(matches, {
      workerTargets: [{ targetId: 'worker-a', displayLabel: 'Alex Rivera · Technician' }],
      jobTargets: [{ targetId: 'job-a', displayLabel: 'Jordan Example · Tree Service' }],
      vehicleTargets: [{ targetId: 'vehicle-a', displayLabel: 'Chip Truck · Ford F-550' }],
      equipmentTargets: [], workerUnavailableTotal: 1, jobUnavailableTotal: 0,
      vehicleUnavailableTotal: 0, equipmentUnavailableTotal: 0,
      presentationBoundary: 'Ambiguous targets require clearer company data.',
    });
    expect(result.workerTargets).toEqual([{ targetId: 'worker-a', operationalRole: 'technician',
      digest: 'a'.repeat(64), displayLabel: 'Alex Rivera · Technician' }]);
    expect(result.jobTargets[0].displayLabel).toBe('Jordan Example · Tree Service');
    expect(result.vehicleTargets[0].displayLabel).toBe('Chip Truck · Ford F-550');
    expect(result.workerUnavailableTotal).toBe(1);
    expect(matches.workerTargets).toHaveLength(2);
  });

  test('fails closed on embedded presentation hazards without rejecting ordinary company labels', () => {
    for (const value of ['Crew [Object Object] · Technician', 'Crew object_object · Technician',
      'Crew 860-555-1212 East · Technician', 'Crew (860) 555-1212 West · Technician',
      `Crew ${'a'.repeat(64)} · Technician`, `Crew digest:${'b'.repeat(64)} · Technician`]) {
      expect(safeDisplayLabel(value)).toBeNull();
    }
    for (const value of ['Hash Tree Service · Technician', 'Route 64 Crew · Technician', 'Chip Truck · Ford F-550']) {
      expect(safeDisplayLabel(value)).toBe(value);
    }
  });
});
