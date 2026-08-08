'use strict';

const {
  adaptBusinessProfile,
  prepareBusinessProfileForWrite,
  projectOperationalConfiguration,
} = require('../../src/services/businessProfileAdapter');

const UNKNOWN_MARKER = '保留🧭\r\noperational-unknown';
const LEGACY_LEAD_TIME = '原文 0️⃣';

function profile() {
  return {
    company: { name: 'Phase Four Co', currency: 'USD' },
    routing: {
      dispatchFrom: 'assigned-crew', trafficEnabled: false, useLiveTraffic: true,
      avoidTolls: false, avoidHighways: true, avoidFerries: false,
      preferredProvider: 'waze', unknownRouting: UNKNOWN_MARKER,
    },
    crew: {
      defaultCrewSize: 2, maxCrewSize: 4, shopTime: 0,
      averageHourlyRate: 0, overtimeMultiplier: 1.5, travelPay: 0,
      minimumBillableHours: 1, unknownCrew: UNKNOWN_MARKER,
    },
    vehicles: {
      truckCount: 0, trailerCount: null, averageMpg: 12.5,
      equipmentTransportCapacity: 0, averageFuelCost: 0,
      hourlyVehicleCost: 0, maintenanceReserve: 0, unknownVehicle: UNKNOWN_MARKER,
    },
    scheduling: {
      maxJobsPerDay: 1, travelBuffer: 0, appointmentBuffer: null,
      workDayLength: 8.5, maxDailyTravel: 0, preferredDispatchStrategy: '',
      leadTimeHours: LEGACY_LEAD_TIME, unknownScheduling: UNKNOWN_MARKER,
    },
    financial: { taxRate: 0, futureFinancial: UNKNOWN_MARKER },
    canonicalPricing: { taxRatePercent: 0 },
    canonicalCosts: { overheadPercent: 0 },
    voiceAssistant: { name: 'North', greeting: UNKNOWN_MARKER },
    policies: { operations: UNKNOWN_MARKER },
  };
}

describe('Mission 20 Phase 4 operational configuration adapter contract', () => {
  test('projects only recognized authority into normalized versions and hashes', () => {
    const raw = profile();
    const projection = projectOperationalConfiguration(raw);
    expect(projection).toEqual({
      routing: {
        dispatchFrom: 'assigned-crew', trafficEnabled: false, useLiveTraffic: true,
        avoidTolls: false, avoidHighways: true, avoidFerries: false,
      },
      crew: { defaultCrewSize: 2, maxCrewSize: 4, shopTime: 0 },
      vehicles: { truckCount: 0, trailerCount: null, averageMpg: 12.5, equipmentTransportCapacity: 0 },
      scheduling: {
        maxJobsPerDay: 1, travelBuffer: 0, appointmentBuffer: null,
        workDayLength: 8.5, maxDailyTravel: 0, preferredDispatchStrategy: '',
      },
    });
    const normalized = adaptBusinessProfile(raw, 'org-profile-v7');
    expect(normalized.operationalConfiguration).toEqual(projection);
    expect(normalized.hash).toMatch(/^[a-f0-9]{64}$/);

    const recognizedChange = profile();
    recognizedChange.scheduling.travelBuffer = 1;
    expect(adaptBusinessProfile(recognizedChange, 'org-profile-v7').hash).not.toBe(normalized.hash);

    const unknownChange = profile();
    unknownChange.scheduling.unknownScheduling = 'different unknown';
    unknownChange.scheduling.leadTimeHours = 'different legacy passthrough';
    expect(adaptBusinessProfile(unknownChange, 'org-profile-v7').hash).toBe(normalized.hash);
  });

  test('preserves explicit zero, null, absence, unknown Unicode, Phase 5/provider fields, and voice bytes', () => {
    const raw = profile();
    delete raw.crew.maxCrewSize;
    const prepared = prepareBusinessProfileForWrite(raw);
    expect(prepared.errors).toEqual([]);
    expect(prepared.profile.routing.unknownRouting).toBe(UNKNOWN_MARKER);
    expect(prepared.profile.routing.preferredProvider).toBe('waze');
    expect(prepared.profile.crew.averageHourlyRate).toBe(0);
    expect(prepared.profile.vehicles.averageFuelCost).toBe(0);
    expect(prepared.profile.scheduling.leadTimeHours).toBe(LEGACY_LEAD_TIME);
    expect(prepared.profile.voiceAssistant.greeting).toBe(UNKNOWN_MARKER);
    expect(prepared.profile.policies.operations).toBe(UNKNOWN_MARKER);
    expect(prepared.profile.vehicles.truckCount).toBe(0);
    expect(prepared.profile.vehicles.trailerCount).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(prepared.profile.crew, 'maxCrewSize')).toBe(false);

    const projection = projectOperationalConfiguration(prepared.profile);
    expect(projection.vehicles.truckCount).toBe(0);
    expect(projection.vehicles.trailerCount).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(projection.crew, 'maxCrewSize')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(projection.routing, 'preferredProvider')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(projection.scheduling, 'leadTimeHours')).toBe(false);
  });

  test.each([
    ['dispatch origin type', value => { value.routing.dispatchFrom = null; }, 'routing.dispatchFrom'],
    ['dispatch origin enum', value => { value.routing.dispatchFrom = 'live-dispatch'; }, 'routing.dispatchFrom'],
    ['routing boolean', value => { value.routing.trafficEnabled = 0; }, 'routing.trafficEnabled'],
    ['crew integer', value => { value.crew.defaultCrewSize = 1.5; }, 'crew.defaultCrewSize'],
    ['crew lower bound', value => { value.crew.maxCrewSize = 0; }, 'crew.maxCrewSize'],
    ['crew accepted upper bound', value => { value.crew.defaultCrewSize = 11; }, 'crew.defaultCrewSize'],
    ['crew relationship', value => { value.crew.defaultCrewSize = 5; value.crew.maxCrewSize = 4; }, 'must not exceed'],
    ['shop time finite', value => { value.crew.shopTime = Infinity; }, 'crew.shopTime'],
    ['truck integer', value => { value.vehicles.truckCount = 0.5; }, 'vehicles.truckCount'],
    ['trailer nonnegative', value => { value.vehicles.trailerCount = -1; }, 'vehicles.trailerCount'],
    ['MPG accepted minimum', value => { value.vehicles.averageMpg = 4.9; }, 'vehicles.averageMpg'],
    ['capacity integer', value => { value.vehicles.equipmentTransportCapacity = 2.2; }, 'vehicles.equipmentTransportCapacity'],
    ['jobs positive integer', value => { value.scheduling.maxJobsPerDay = 0; }, 'scheduling.maxJobsPerDay'],
    ['travel buffer integer', value => { value.scheduling.travelBuffer = 1.2; }, 'scheduling.travelBuffer'],
    ['workday finite minimum', value => { value.scheduling.workDayLength = 0; }, 'scheduling.workDayLength'],
    ['strategy enum', value => { value.scheduling.preferredDispatchStrategy = 'autonomous'; }, 'preferredDispatchStrategy'],
  ])('globally rejects invalid recognized %s without interpreting unknown keys', (_label, mutate, expected) => {
    const value = profile();
    mutate(value);
    expect(prepareBusinessProfileForWrite(value).errors.join('\n')).toContain(expected);
  });

  test('allows null recognized numeric values while requiring exact booleans', () => {
    const value = profile();
    for (const field of ['defaultCrewSize', 'maxCrewSize', 'shopTime']) value.crew[field] = null;
    for (const field of ['truckCount', 'trailerCount', 'averageMpg', 'equipmentTransportCapacity']) value.vehicles[field] = null;
    for (const field of ['maxJobsPerDay', 'travelBuffer', 'appointmentBuffer', 'workDayLength', 'maxDailyTravel']) {
      value.scheduling[field] = null;
    }
    expect(prepareBusinessProfileForWrite(value).errors).toEqual([]);
    value.routing.avoidTolls = null;
    expect(prepareBusinessProfileForWrite(value).errors.join('\n')).toContain('routing.avoidTolls must be a boolean');
  });
});
