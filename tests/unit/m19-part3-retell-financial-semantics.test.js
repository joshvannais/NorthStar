'use strict';

const { mapExecutiveContextToVariables, retellFinancialSemantics } = require('../../src/retell/client');

function variables(businessProfile) {
  return mapExecutiveContextToVariables({ businessProfile });
}

function expectConsistent(result, expected) {
  const semantics = retellFinancialSemantics(result.profile);
  for (const [key, value] of Object.entries(expected)) {
    expect(semantics[key]).toEqual(value);
    expect(result.variables.pricing_rules).toContain(`${key}=${value.value} (${value.status})`);
    expect(result.variables[key]).toBeUndefined();
    expect(result.variables[key + '_status']).toBeUndefined();
  }
}

function mapped(profile) {
  return { profile, variables: variables(profile) };
}

describe('Mission 19 Part 3 Retell financial semantics', () => {
  test('explicit zero remains configured zero for every supported financial variable', () => {
    const result = mapped({
      financial: { minimumJobPrice: 0, emergencyMarkup: 0, travelCharge: 0, taxRate: 91 },
      canonicalPricing: { minimumJobPrice: 0, emergencyMultiplier: 0, travelCustomerChargePerMile: 0, taxRatePercent: 0 },
    });
    expectConsistent(result, {
      minimum_job_price: { value: '0', status: 'configured' },
      emergency_markup: { value: '0', status: 'configured' },
      travel_charge: { value: '0', status: 'configured' },
      tax_rate: { value: '0', status: 'configured' },
    });
    expect(result.variables.pricing_rules).not.toMatch(/150|1\.5|0\.58|7%/);
  });

  test('missing values remain explicitly not configured without fabricated defaults', () => {
    const result = mapped({ financial: {}, canonicalPricing: {} });
    const missing = { value: 'not_configured', status: 'not_configured' };
    expectConsistent(result, {
      minimum_job_price: missing,
      emergency_markup: missing,
      travel_charge: missing,
      tax_rate: missing,
    });
    expect(result.variables.pricing_rules).toContain('Do not quote, infer, or replace financial values marked not_configured or unavailable.');
  });

  test('malformed values are unavailable and legacy tax cannot become canonical tax authority', () => {
    const result = mapped({
      financial: { minimumJobPrice: '150', emergencyMarkup: -1, travelCharge: null, taxRate: 7 },
      canonicalPricing: { minimumJobPrice: '150', taxRatePercent: 100.01 },
    });
    expectConsistent(result, {
      minimum_job_price: { value: 'unavailable', status: 'unavailable' },
      emergency_markup: { value: 'unavailable', status: 'unavailable' },
      travel_charge: { value: 'unavailable', status: 'unavailable' },
      tax_rate: { value: 'unavailable', status: 'unavailable' },
    });
    expect(result.variables.pricing_rules).not.toContain('tax_rate=7');
  });

  test('positive canonical values and different pinned organizations remain exact', () => {
    const organizationA = mapped({
      financial: { minimumJobPrice: 275, emergencyMarkup: 1.25, travelCharge: 0.75 },
      canonicalPricing: { minimumJobPrice: 275, emergencyMultiplier: 1.4, travelCustomerChargePerMile: 1.1, taxRatePercent: 8.25 },
    });
    const organizationB = mapped({
      financial: { minimumJobPrice: 50, emergencyMarkup: 2, travelCharge: 3 },
      canonicalPricing: { minimumJobPrice: 50, emergencyMultiplier: 2, travelCustomerChargePerMile: 3, taxRatePercent: 0 },
    });
    expectConsistent(organizationA, {
      minimum_job_price: { value: '275', status: 'configured' },
      emergency_markup: { value: '1.4', status: 'configured' },
      travel_charge: { value: '1.1', status: 'configured' },
      tax_rate: { value: '8.25', status: 'configured' },
    });
    expectConsistent(organizationB, {
      minimum_job_price: { value: '50', status: 'configured' },
      emergency_markup: { value: '2', status: 'configured' },
      travel_charge: { value: '3', status: 'configured' },
      tax_rate: { value: '0', status: 'configured' },
    });
    expect(organizationA.variables.pricing_rules).not.toBe(organizationB.variables.pricing_rules);
  });
});
