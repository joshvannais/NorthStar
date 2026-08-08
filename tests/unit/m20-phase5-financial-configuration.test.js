'use strict';

const {
  CALCULATION_VERSION,
  calculateCanonicalPolaris,
} = require('../../src/services/canonicalPolarisCalculation');
const {
  adaptBusinessProfile,
  migrateLegacyFinancialConfiguration,
  prepareBusinessProfileForWrite,
  projectFinancialConfiguration,
  validateFinancialConfiguration,
} = require('../../src/services/businessProfileAdapter');
const {
  canonicalFenceProfile,
  canonicalFenceScope,
} = require('../helpers/m19-part3-business-profile');

const IDS = Object.freeze({
  organizationId: '00000000-0000-0000-0000-000000000001',
  customerId: '10000000-0000-0000-0000-000000000001',
  opportunityId: '20000000-0000-0000-0000-000000000001',
});

function profileFixture() {
  const profile = canonicalFenceProfile();
  profile.canonicalPricing = {
    ...profile.canonicalPricing,
    desiredGrossMarginPercent: 0,
    desiredNetMarginPercent: 0,
    maximumDiscountPercent: 0,
    defaultRangePercent: 0,
    futurePricing: 'P\r\n😀',
  };
  profile.canonicalCosts = {
    ...profile.canonicalCosts,
    materialCostByService: {},
    equipmentCostByReference: { 'mini-excavator': 0 },
    futureCosts: 'C\r\n😀',
  };
  profile.crew = {
    ...profile.crew,
    averageHourlyRate: 0,
    overtimeMultiplier: 1,
    travelPay: null,
    minimumBillableHours: 0,
    futureCrew: 'R\r\n😀',
  };
  profile.vehicles = {
    averageFuelCost: 0,
    hourlyVehicleCost: null,
    maintenanceReserve: 100,
    futureVehicle: 'V\r\n😀',
  };
  return profile;
}

function calculationInput(profile) {
  return {
    ...IDS,
    calculationVersion: CALCULATION_VERSION,
    service: { key: 'fence', scope: canonicalFenceScope() },
    transcript: [],
    facts: [],
    businessProfile: profile,
    businessProfileAuthority: {
      id: '30000000-0000-0000-0000-000000000001',
      versionLabel: 'org-profile-v12',
      profileHash: 'f'.repeat(64),
    },
    appointmentPreference: null,
    travel: null,
    actualCrewAssignment: null,
    callDurationSeconds: null,
  };
}

describe('Mission 20 Phase 5 Financial Configuration contract', () => {
  test('projects only recognized financial authority and preserves explicit zero/null semantics', () => {
    const profile = profileFixture();
    expect(validateFinancialConfiguration(profile)).toEqual([]);
    expect(projectFinancialConfiguration(profile)).toEqual({
      canonicalPricing: expect.objectContaining({
        desiredGrossMarginPercent: 0,
        desiredNetMarginPercent: 0,
        maximumDiscountPercent: 0,
        defaultRangePercent: 0,
      }),
      canonicalCosts: expect.objectContaining({
        materialCostByService: {},
        equipmentCostByReference: { 'mini-excavator': 0 },
      }),
      crew: {
        averageHourlyRate: 0,
        overtimeMultiplier: 1,
        travelPay: null,
        minimumBillableHours: 0,
      },
      vehicles: {
        averageFuelCost: 0,
        hourlyVehicleCost: null,
        maintenanceReserve: 100,
      },
    });
    const projection = projectFinancialConfiguration(profile);
    expect(projection.canonicalPricing.futurePricing).toBeUndefined();
    expect(projection.canonicalCosts.futureCosts).toBeUndefined();
    expect(projection.crew.futureCrew).toBeUndefined();
    expect(projection.vehicles.futureVehicle).toBeUndefined();
  });

  test.each([
    [{ canonicalPricing: { taxRatePercent: null } }, /taxRatePercent/],
    [{ canonicalPricing: { defaultRangePercent: 101 } }, /defaultRangePercent/],
    [{ canonicalPricing: { desiredGrossMarginPercent: 20, desiredNetMarginPercent: 21 } }, /must not exceed/],
    [{ canonicalPricing: { maximumDiscountPercent: '0' } }, /maximumDiscountPercent/],
    [{ canonicalCosts: { materialCostByService: { '': 1 } } }, /materialCostByService/],
    [{ canonicalCosts: { equipmentCostByReference: { truck: -1 } } }, /equipmentCostByReference/],
    [{ crew: { averageHourlyRate: -1 } }, /averageHourlyRate/],
    [{ crew: { overtimeMultiplier: 0.99 } }, /overtimeMultiplier/],
    [{ vehicles: { maintenanceReserve: 101 } }, /maintenanceReserve/],
  ])('rejects strict financial value %#', (value, expected) => {
    expect(validateFinancialConfiguration(value).join('\n')).toMatch(expected);
  });

  test('migrates only missing valid margin fields, keeps canonical zero, and preserves legacy/raw bytes', () => {
    const raw = profileFixture();
    raw.canonicalPricing.desiredGrossMarginPercent = 0;
    delete raw.canonicalPricing.desiredNetMarginPercent;
    delete raw.canonicalPricing.maximumDiscountPercent;
    raw.financial = {
      desiredGrossMargin: 88,
      desiredNetMargin: 22,
      maximumDiscount: 0,
      defaultRangePercent: 77,
      unknownLegacy: 'legacy\r\n😀',
    };
    raw.unknownFuture = undefined;
    const migrated = migrateLegacyFinancialConfiguration(raw);
    expect(migrated.profile.canonicalPricing.desiredGrossMarginPercent).toBe(0);
    expect(migrated.profile.canonicalPricing.desiredNetMarginPercent).toBe(22);
    expect(migrated.profile.canonicalPricing.maximumDiscountPercent).toBe(0);
    expect(migrated.profile.canonicalPricing.defaultRangePercent).toBe(0);
    expect(migrated.profile.financial).toEqual(raw.financial);
    expect(migrated.migratedFields).toEqual([
      'canonicalPricing.desiredNetMarginPercent',
      'canonicalPricing.maximumDiscountPercent',
    ]);

    const invalid = profileFixture();
    delete invalid.canonicalPricing.desiredNetMarginPercent;
    invalid.financial = { desiredNetMargin: '22', maximumDiscount: -1 };
    expect(migrateLegacyFinancialConfiguration(invalid).profile.canonicalPricing.desiredNetMarginPercent).toBeUndefined();
    expect(migrateLegacyFinancialConfiguration(invalid).profile.canonicalPricing.maximumDiscountPercent).toBe(0);

    const noMigratableLegacyValue = {
      financial: {
        desiredGrossMargin: null,
        desiredNetMargin: '22',
        maximumDiscount: false,
        futureLegacy: 'future legacy bytes',
      },
      futureRoot: 'future root bytes',
    };
    const unchanged = migrateLegacyFinancialConfiguration(noMigratableLegacyValue);
    expect(unchanged.migratedFields).toEqual([]);
    expect(unchanged.profile).not.toHaveProperty('canonicalPricing');
    expect(unchanged.profile).toEqual(noMigratableLegacyValue);
  });

  test('write preparation retains unknown siblings and never coerces zero labor cost', () => {
    const profile = profileFixture();
    const prepared = prepareBusinessProfileForWrite(profile);
    expect(prepared.errors).toEqual([]);
    expect(prepared.profile.crew.averageHourlyRate).toBe(0);
    expect(prepared.profile.canonicalPricing.futurePricing).toBe('P\r\n😀');
    expect(prepared.profile.canonicalCosts.futureCosts).toBe('C\r\n😀');
    expect(prepared.profile.vehicles.futureVehicle).toBe('V\r\n😀');
    expect(adaptBusinessProfile(profile, 'org-profile-v12').crew.averageHourlyCost).toBe(0);
    expect(adaptBusinessProfile(profile, 'org-profile-v12').pricing.defaultRangePercent).toBe(0);
  });

  test('service range wins including zero; otherwise profile default wins without changing base price or tax', () => {
    const serviceZero = profileFixture();
    serviceZero.canonicalPricing.defaultRangePercent = 25;
    serviceZero.services[0].canonicalPricing.rangePercent = 0;
    const explicit = calculateCanonicalPolaris(calculationInput(serviceZero));
    expect(explicit.preliminaryRange).toEqual({
      low: explicit.customerFacingPrice,
      high: explicit.customerFacingPrice,
    });
    expect(explicit.businessProfileFieldsUsed).toContain('services[fence].canonicalPricing.rangePercent');
    expect(explicit.businessProfileFieldsUsed).not.toContain('canonicalPricing.defaultRangePercent');

    const fallback = profileFixture();
    fallback.canonicalPricing.taxRatePercent = 9;
    fallback.canonicalPricing.defaultRangePercent = 5;
    delete fallback.services[0].canonicalPricing.rangePercent;
    const ranged = calculateCanonicalPolaris(calculationInput(fallback));
    const noFallback = JSON.parse(JSON.stringify(fallback));
    delete noFallback.canonicalPricing.defaultRangePercent;
    const unranged = calculateCanonicalPolaris(calculationInput(noFallback));
    expect(ranged.preliminaryRange).toEqual({
      low: Math.round(ranged.customerFacingPrice * 0.95 * 100) / 100,
      high: Math.round(ranged.customerFacingPrice * 1.05 * 100) / 100,
    });
    expect(ranged.businessProfileFieldsUsed).toContain('canonicalPricing.defaultRangePercent');
    expect(ranged.customerFacingPrice).toBe(unranged.customerFacingPrice);
    expect(ranged.tax).toBe(unranged.tax);
    expect(unranged.preliminaryRange).toBeNull();

    fallback.canonicalPricing.defaultRangePercent = 0;
    const profileZero = calculateCanonicalPolaris(calculationInput(fallback));
    expect(profileZero.preliminaryRange).toEqual({
      low: profileZero.customerFacingPrice,
      high: profileZero.customerFacingPrice,
    });
  });
});
