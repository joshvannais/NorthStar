'use strict';

const {
  adaptBusinessProfile,
  migrateLegacyCanonicalAuthority,
  prepareBusinessProfileForWrite,
  synchronizeLegacyFinancial,
} = require('../../src/services/businessProfileAdapter');

describe('Mission 19 Part 3 canonical Business Profile authority', () => {
  test('legacy financial values migrate once only when canonical blocks are absent', () => {
    const migrated = migrateLegacyCanonicalAuthority({
      financial: {
        markup: 1.25,
        taxRate: 9,
        emergencyMarkup: 0,
        travelCharge: 0,
        minimumJobPrice: 0,
        overheadPercent: 12,
      },
    });
    expect(migrated.migratedFields).toEqual(['canonicalPricing', 'canonicalCosts']);
    expect(migrated.profile.canonicalPricing).toEqual({
      customerMarkupPercent: 25,
      taxRatePercent: 9,
      emergencyMultiplier: 0,
      travelCustomerChargePerMile: 0,
      minimumJobPrice: 0,
    });
    expect(migrated.profile.canonicalCosts).toEqual({ overheadPercent: 12 });

    const canonical = migrateLegacyCanonicalAuthority({
      financial: { markup: 9.99, taxRate: 77, emergencyMarkup: 8, travelCharge: 7, minimumJobPrice: 600 },
      canonicalPricing: {
        customerMarkupPercent: 0,
        taxRatePercent: 0,
        emergencyMultiplier: 0,
        travelCustomerChargePerMile: 0,
        minimumJobPrice: 0,
      },
      canonicalCosts: {},
    });
    expect(canonical.migratedFields).toEqual([]);
    expect(canonical.profile.canonicalPricing).toEqual({
      customerMarkupPercent: 0,
      taxRatePercent: 0,
      emergencyMultiplier: 0,
      travelCustomerChargePerMile: 0,
      minimumJobPrice: 0,
    });
    expect(synchronizeLegacyFinancial(canonical.profile).financial).toEqual({
      markup: 1,
      taxRate: 0,
      emergencyMarkup: 0,
      travelCharge: 0,
      minimumJobPrice: 0,
    });
  });

  test('zero, missing, malformed, and positive configuration remain distinct', () => {
    const zero = prepareBusinessProfileForWrite({
      canonicalPricing: {
        customerMarkupPercent: 0,
        taxRatePercent: 0,
        emergencyMultiplier: 0,
        travelCustomerChargePerMile: 0,
        minimumJobPrice: 0,
      },
      canonicalCosts: { overheadPercent: 0, travelCostPerMile: 0 },
    });
    expect(zero.errors).toEqual([]);
    expect(adaptBusinessProfile(zero.profile, 'zero-v1').pricing).toMatchObject({
      customerMarkupPercent: 0,
      taxRatePercent: 0,
      emergencyMultiplier: 0,
      travelCustomerChargePerMile: 0,
      minimumJobPrice: 0,
    });

    const missing = prepareBusinessProfileForWrite({ canonicalPricing: {}, canonicalCosts: {} });
    expect(missing.errors).toEqual([]);
    expect(adaptBusinessProfile(missing.profile, 'missing-v1').pricing).toMatchObject({
      customerMarkupPercent: null,
      taxRatePercent: null,
      emergencyMultiplier: null,
      travelCustomerChargePerMile: null,
      minimumJobPrice: null,
    });

    const malformed = prepareBusinessProfileForWrite({
      canonicalPricing: { taxRatePercent: '9', emergencyMultiplier: -1 },
      canonicalCosts: { materialCostByService: { 'fence:cedar': 'not-a-number' } },
    });
    expect(malformed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('canonicalPricing.taxRatePercent'),
      expect.stringContaining('canonicalPricing.emergencyMultiplier'),
      expect.stringContaining('canonicalCosts.materialCostByService.fence:cedar'),
    ]));
    expect(synchronizeLegacyFinancial({
      canonicalPricing: { taxRatePercent: '9', emergencyMultiplier: -1 },
      financial: { taxRate: 77, emergencyMarkup: 8.88 },
    }).financial).toEqual({});

    const positive = prepareBusinessProfileForWrite({
      canonicalPricing: { taxRatePercent: 9, emergencyMultiplier: 1.4, travelCustomerChargePerMile: 1.25 },
      canonicalCosts: { overheadPercent: 15, travelCostPerMile: 0.67 },
    });
    expect(positive.errors).toEqual([]);
    expect(adaptBusinessProfile(positive.profile, 'positive-v1')).toMatchObject({
      pricing: { taxRatePercent: 9, emergencyMultiplier: 1.4, travelCustomerChargePerMile: 1.25 },
      costs: { overheadPercent: 15, travelCostPerMile: 0.67 },
    });
  });
});
