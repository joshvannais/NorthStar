'use strict';

function canonicalFenceProfile(overrides) {
  const options = overrides || {};
  return {
    version: options.version || 'bp-extreme-v1',
    company: {
      name: options.companyName || 'Profile Authority Fence Company',
      currency: 'USD',
    },
    crew: {
      defaultCrewSize: options.defaultCrewSize === undefined ? 2 : options.defaultCrewSize,
      averageHourlyRate: options.averageHourlyRate === undefined ? 42 : options.averageHourlyRate,
      overtimeMultiplier: 1.5,
    },
    financial: {
      markup: 9.99,
      emergencyMarkup: 8.88,
      travelCharge: 7.77,
    },
    canonicalPricing: {
      customerMarkupPercent: options.customerMarkupPercent === undefined ? 0 : options.customerMarkupPercent,
      travelCustomerChargePerMile: options.travelCustomerChargePerMile === undefined ? 0 : options.travelCustomerChargePerMile,
      emergencyMultiplier: options.emergencyMultiplier === undefined ? 1 : options.emergencyMultiplier,
      taxRatePercent: options.taxRatePercent === undefined ? 0 : options.taxRatePercent,
    },
    canonicalCosts: {
      overheadPercent: options.overheadPercent === undefined ? 55 : options.overheadPercent,
      travelCostPerMile: options.travelCostPerMile === undefined ? 0 : options.travelCostPerMile,
      materialCostByService: options.materialCostByService || { 'fence:cedar': 12000 },
      equipmentCostByReference: {},
    },
    services: [{
      id: 'fence',
      name: options.serviceName || 'Persisted Profile Fence',
      crewSize: options.crewSize === undefined ? 2 : options.crewSize,
      canonicalPricing: {
        requiredScope: [
          'jobType', 'linearFeet', 'material', 'removalRequired', 'gates', 'permitsRequired',
        ],
        allowedScopeValues: {
          jobType: ['replace', 'install', 'repair'],
        },
        rangePercent: options.rangePercent === undefined ? 10 : options.rangePercent,
        lineItems: [
          {
            code: 'profile-labor',
            label: 'Profile labor per foot',
            category: 'labor',
            type: 'perUnit',
            quantityField: 'linearFeet',
            unitRate: options.laborPerFoot === undefined ? 99 : options.laborPerFoot,
          },
          {
            code: 'profile-material',
            label: 'Profile material per foot',
            category: 'materials',
            type: 'perUnitByValue',
            quantityField: 'linearFeet',
            selectorField: 'material',
            unitRates: options.materialRates || { cedar: 123, pine: 71 },
          },
          {
            code: 'profile-permit',
            label: 'Profile permit charge',
            category: 'serviceCharge',
            type: 'fixed',
            amount: options.permitCharge === undefined ? 9999 : options.permitCharge,
            when: { field: 'permitsRequired', equals: true },
          },
          {
            code: 'profile-gates',
            label: 'Profile gate charge',
            category: 'materials',
            type: 'perItemByValue',
            collectionField: 'gates',
            selectorField: 'type',
            unitRates: options.gateRates || { walk: 777, drive: 4321 },
          },
          {
            code: 'profile-removal',
            label: 'Profile removal per foot',
            category: 'labor',
            type: 'perUnit',
            quantityField: 'linearFeet',
            unitRate: options.removalPerFoot === undefined ? 44 : options.removalPerFoot,
            when: { field: 'removalRequired', equals: true },
          },
        ],
      },
    }],
  };
}

function canonicalFenceScope(overrides) {
  return {
    jobType: 'replace',
    linearFeet: 100,
    material: 'cedar',
    height: 6,
    removalRequired: true,
    gates: [{ type: 'walk', width: 4 }],
    permitsRequired: true,
    ...(overrides || {}),
  };
}

module.exports = {
  EXTREME_FENCE_SUBTOTAL: 37376,
  canonicalFenceProfile,
  canonicalFenceScope,
};
