'use strict';

const pipeline = require('../../src/routes/simulation/pipeline');
const scenarios = require('../../src/routes/simulation/scenario-catalog');
const eventIntelligence = require('../../src/voice/eventIntelligence');
const { adaptBusinessProfile, stableStringify } = require('../../src/services/businessProfileAdapter');
const { detectEmergencyEvidence } = require('../../src/services/emergencyEvidence');
const {
  CALCULATION_VERSION,
  adaptLiveInput,
  adaptSimulationInput,
  calculateCanonicalPolaris,
  readHistoricalSnapshot,
} = require('../../src/services/canonicalPolarisCalculation');
const {
  EXTREME_FENCE_SUBTOTAL,
  canonicalFenceProfile,
  canonicalFenceScope,
} = require('../helpers/m19-part3-business-profile');

const IDS = Object.freeze({
  organizationId: '00000000-0000-0000-0000-000000000001',
  customerId: '10000000-0000-0000-0000-000000000001',
  opportunityId: '20000000-0000-0000-0000-000000000001',
});

function fenceInput(overrides) {
  return {
    ...IDS,
    calculationVersion: CALCULATION_VERSION,
    service: { key: 'fence', scope: canonicalFenceScope() },
    transcript: [
      { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot cedar fence and the existing fence removed.' },
      { turnId: 'turn-2', speaker: 'customer', text: 'Please include one walk gate. Weekday mornings work best. This is not an emergency.' },
    ],
    facts: [
      { id: 'fact-linear-feet', variable: 'linearFeet', status: 'collected', normalizedValue: 100, evidenceTurnId: 'turn-1' },
      { id: 'fact-material', variable: 'material', status: 'collected', normalizedValue: 'cedar', evidenceTurnId: 'turn-1' },
      { id: 'fact-removal', variable: 'removalRequired', status: 'collected', normalizedValue: true, evidenceTurnId: 'turn-1' },
      { id: 'fact-gate', variable: 'gates', status: 'collected', normalizedValue: [{ type: 'walk' }], evidenceTurnId: 'turn-2' },
    ],
    businessProfile: canonicalFenceProfile(),
    businessProfileAuthority: {
      id: '30000000-0000-0000-0000-000000000001',
      versionLabel: 'org-profile-v1',
      profileHash: 'b'.repeat(64),
    },
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    travel: null,
    callDurationSeconds: 242,
    actualCrewAssignment: null,
    ...(overrides || {}),
  };
}

function withoutTax(profile) {
  const copy = JSON.parse(JSON.stringify(profile));
  delete copy.canonicalPricing.taxRatePercent;
  return copy;
}

describe('Mission 19 Part 3 canonical calculation contract', () => {
  test('normalizes stable service authority without activating legacy financial knobs', () => {
    const raw = canonicalFenceProfile();
    const first = adaptBusinessProfile(raw, 'bp-fixture-v1');
    const second = adaptBusinessProfile(JSON.parse(JSON.stringify(raw)), 'bp-fixture-v1');
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(second.hash);
    expect(first.pricing).toMatchObject({
      customerMarkupPercent: 0,
      travelCustomerChargePerMile: 0,
      emergencyMultiplier: 1,
      taxRatePercent: 0,
      legacyCatalogMarkupMultiplier: 9.99,
      legacyTravelChargePerMile: 7.77,
      legacyEmergencyMultiplier: 8.88,
    });
    expect(first.services).toEqual([
      expect.objectContaining({
        id: 'fence',
        name: 'Persisted Profile Fence',
        canonicalPricing: expect.objectContaining({ rangePercent: 10 }),
      }),
    ]);
  });

  test('calculates the adversarial fence solely from the pinned persisted profile', () => {
    const result = calculateCanonicalPolaris(fenceInput());
    expect(result.customerFacingPrice).toBe(EXTREME_FENCE_SUBTOTAL);
    expect(result.subtotalBeforeTax).toBe(EXTREME_FENCE_SUBTOTAL);
    expect(result.customerFacingPrice).not.toBe(4510);
    expect(result.taxRatePercent).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.totalIncludingTax).toBe(EXTREME_FENCE_SUBTOTAL);
    expect(result.taxDisposition).toEqual({ status: 'calculated', reason: null });
    expect(result.preliminaryRange).toEqual({ low: 33638.4, high: 41113.6 });
    expect(result.pricingLineItems).toEqual([
      expect.objectContaining({ code: 'profile-profile-labor', category: 'labor', customerCharge: 9900 }),
      expect.objectContaining({ code: 'profile-profile-material', category: 'materials', customerCharge: 12300 }),
      expect.objectContaining({ code: 'profile-profile-permit', customerCharge: 9999 }),
      expect.objectContaining({ code: 'profile-profile-gates', category: 'materials', customerCharge: 777 }),
      expect.objectContaining({ code: 'profile-profile-removal', category: 'labor', customerCharge: 4400 }),
    ]);
    expect(result.materialsCharge).toBe(13077);
    expect(result.laborCharge).toBe(14300);
    expect(result.businessProfileInputId).toBe('30000000-0000-0000-0000-000000000001');
    expect(result.businessProfileInputVersion).toBe('org-profile-v1');
    expect(result.businessProfileInputHash).toBe('b'.repeat(64));
    expect(result.businessProfileFieldsUsed).toEqual(expect.arrayContaining([
      'services[fence].canonicalPricing.lineItems[profile-labor].unitRate',
      'services[fence].canonicalPricing.lineItems[profile-material].unitRates.cedar',
      'services[fence].canonicalPricing.lineItems[profile-permit].amount',
      'services[fence].canonicalPricing.lineItems[profile-gates].unitRates.walk',
      'services[fence].canonicalPricing.lineItems[profile-removal].unitRate',
      'services[fence].canonicalPricing.allowedScopeValues.jobType',
    ]));
    expect(result.supportingTranscriptFactIds).toEqual([
      'fact-gate', 'fact-linear-feet', 'fact-material', 'fact-removal',
    ]);
    expect(stableStringify(result)).not.toMatch(/NaN|Infinity/);
  });

  test('different organization profiles and profile versions produce their exact configured results', () => {
    const alternate = canonicalFenceProfile({
      version: 'bp-alternate-v7',
      companyName: 'Other Organization',
      laborPerFoot: 1,
      materialRates: { cedar: 2 },
      permitCharge: 3,
      gateRates: { walk: 4 },
      removalPerFoot: 5,
      rangePercent: 0,
    });
    const result = calculateCanonicalPolaris(fenceInput({
      organizationId: '00000000-0000-0000-0000-000000000002',
      businessProfile: alternate,
      businessProfileAuthority: {
        id: '30000000-0000-0000-0000-000000000002',
        versionLabel: 'org-profile-v7',
        profileHash: 'c'.repeat(64),
      },
    }));
    expect(result.customerFacingPrice).toBe(807);
    expect(result.preliminaryRange).toEqual({ low: 807, high: 807 });
    expect(result.businessProfileInputVersion).toBe('org-profile-v7');
    expect(result.businessProfileInputHash).toBe('c'.repeat(64));
    expect(stableStringify(result)).not.toContain('4510');
  });

  test.each([
    ['configured', 8.25, 3083.52, 40459.52],
    ['explicit zero', 0, 0, EXTREME_FENCE_SUBTOTAL],
  ])('calculates tax only from %s organization configuration', (_label, rate, expectedTax, expectedTotal) => {
    const result = calculateCanonicalPolaris(fenceInput({
      businessProfile: canonicalFenceProfile({ taxRatePercent: rate }),
      pricingSettings: { taxRatePercent: 99 },
    }));
    expect(result.subtotalBeforeTax).toBe(EXTREME_FENCE_SUBTOTAL);
    expect(result.taxRatePercent).toBe(rate);
    expect(result.tax).toBe(expectedTax);
    expect(result.totalIncludingTax).toBe(expectedTotal);
    expect(result.taxDisposition).toEqual({ status: 'calculated', reason: null });
  });

  test('missing and malformed tax never fabricate a rate or total', () => {
    for (const profile of [
      withoutTax(canonicalFenceProfile()),
      canonicalFenceProfile({ taxRatePercent: 'not-a-rate' }),
      canonicalFenceProfile({ taxRatePercent: 100.01 }),
    ]) {
      const result = calculateCanonicalPolaris(fenceInput({
        businessProfile: profile,
        pricingSettings: { taxRatePercent: 7 },
      }));
      expect(result.customerFacingPrice).toBe(EXTREME_FENCE_SUBTOTAL);
      expect(result.taxRatePercent).toBeNull();
      expect(result.tax).toBeNull();
      expect(result.totalIncludingTax).toBeNull();
      expect(result.taxDisposition).toEqual({
        status: 'notCalculated',
        reason: 'tax_configuration_unavailable',
      });
      expect(result.notCalculated).toContainEqual({
        field: 'tax',
        reason: 'tax_configuration_unavailable',
      });
    }
  });

  test('missing, malformed, unsupported, and contradictory pricing inputs fail explicitly', () => {
    const noService = calculateCanonicalPolaris(fenceInput({
      businessProfile: { ...canonicalFenceProfile(), services: [] },
    }));
    expect(noService.customerFacingPrice).toBeNull();
    expect(noService.service.unpricedReason).toBe('service_not_configured');

    const noConfigProfile = canonicalFenceProfile();
    noConfigProfile.services = [{ id: 'fence', name: 'Unconfigured Fence' }];
    const noConfig = calculateCanonicalPolaris(fenceInput({ businessProfile: noConfigProfile }));
    expect(noConfig.customerFacingPrice).toBeNull();
    expect(noConfig.service.unpricedReason).toBe('service_pricing_configuration_missing');

    const malformedProfile = canonicalFenceProfile();
    malformedProfile.services[0].canonicalPricing.lineItems[0].unitRate = 'not-a-rate';
    const malformed = calculateCanonicalPolaris(fenceInput({ businessProfile: malformedProfile }));
    expect(malformed.customerFacingPrice).toBeNull();
    expect(malformed.service.unpricedReason).toBe('pricing_rule_rate_malformed:profile-labor');

    const unsupportedService = calculateCanonicalPolaris(fenceInput({
      service: { key: 'roofing', scope: {} },
    }));
    expect(unsupportedService.customerFacingPrice).toBeNull();
    expect(unsupportedService.service.unpricedReason).toBe('service_not_configured');

    const unsupportedJob = calculateCanonicalPolaris(fenceInput({
      service: { key: 'fence', scope: canonicalFenceScope({ jobType: 'inspect' }) },
    }));
    expect(unsupportedJob.customerFacingPrice).toBeNull();
    expect(unsupportedJob.service.unpricedReason).toBe('pricing_scope_value_unsupported:jobType:inspect');

    const unsupportedMaterial = calculateCanonicalPolaris(fenceInput({
      service: { key: 'fence', scope: canonicalFenceScope({ material: 'mystery composite' }) },
    }));
    expect(unsupportedMaterial.customerFacingPrice).toBeNull();
    expect(unsupportedMaterial.service.unpricedReason)
      .toBe('pricing_scope_value_unsupported:material:mystery composite');

    const missing = calculateCanonicalPolaris(fenceInput({
      service: {
        key: 'fence',
        scope: canonicalFenceScope({ linearFeet: undefined }),
      },
    }));
    expect(missing.customerFacingPrice).toBeNull();
    expect(missing.service.unpricedReason).toBe('required_scope_unavailable:linearFeet');

    const conflicting = calculateCanonicalPolaris(fenceInput({
      facts: [{ id: 'fact-conflict', variable: 'linearFeet', status: 'conflicting', normalizedValue: null }],
    }));
    expect(conflicting.customerFacingPrice).toBeNull();
    expect(conflicting.service.unpricedReason).toBe('required_scope_unavailable:linearFeet');
    expect(conflicting.risk.contradictoryFactIds).toEqual(['fact-conflict']);
  });

  test('explicit zero profile rates remain an exact calculated zero', () => {
    const zero = canonicalFenceProfile({
      laborPerFoot: 0,
      materialRates: { cedar: 0 },
      permitCharge: 0,
      gateRates: { walk: 0 },
      removalPerFoot: 0,
      taxRatePercent: 0,
      overheadPercent: 0,
      materialCostByService: { 'fence:cedar': 0 },
      averageHourlyRate: 0,
      rangePercent: 0,
    });
    const result = calculateCanonicalPolaris(fenceInput({
      businessProfile: zero,
      service: { key: 'fence', scope: canonicalFenceScope({ laborHours: 0 }) },
    }));
    expect(result.customerFacingPrice).toBe(0);
    expect(result.taxRatePercent).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.totalIncludingTax).toBe(0);
    expect(result.preliminaryRange).toEqual({ low: 0, high: 0 });
    expect(result.pricingLineItems.every(item => item.customerCharge === 0)).toBe(true);
  });

  test('caller financial overrides have no authority and direct costs remain distinct', () => {
    const input = fenceInput({
      service: { key: 'fence', scope: canonicalFenceScope({ laborHours: 4 }) },
      pricingSettings: {
        customerMarkupPercent: 900,
        travelCustomerChargePerMile: 900,
        emergencyMultiplier: 9,
        taxRatePercent: 99,
      },
      costSettings: { materialCost: 1, overheadPercent: 1 },
    });
    const result = calculateCanonicalPolaris(input);
    expect(result.customerFacingPrice).toBe(EXTREME_FENCE_SUBTOTAL);
    expect(result.knownDirectMaterialCost).toBe(12000);
    expect(result.knownInternalLaborCost).toBe(336);
    expect(result.knownDirectCosts).toBe(12336);
    expect(result.grossProfit).toBe(25040);
    expect(result.overhead).toBe(6784.8);
    expect(result.netProfit).toBe(18255.2);
  });

  test('emergency adjustment requires current customer evidence and persisted profile configuration', () => {
    const currentEmergency = [{ turnId: 'e1', speaker: 'customer', text: 'There is water flooding the room right now.' }];
    const requestOnly = calculateCanonicalPolaris(fenceInput({
      transcript: currentEmergency,
      pricingSettings: { emergencyMultiplier: 1.5 },
    }));
    expect(requestOnly.customerFacingPrice).toBe(EXTREME_FENCE_SUBTOTAL);

    const configured = calculateCanonicalPolaris(fenceInput({
      transcript: currentEmergency,
      businessProfile: canonicalFenceProfile({ emergencyMultiplier: 1.5 }),
    }));
    expect(configured.customerFacingPrice).toBe(56064);
    expect(configured.risk).toMatchObject({ emergency: true, signal: 'active flooding' });

    const historical = calculateCanonicalPolaris(fenceInput({
      transcript: [{ speaker: 'customer', text: 'It flooded yesterday, but it was fixed and is fine now.' }],
      businessProfile: canonicalFenceProfile({ emergencyMultiplier: 1.5 }),
    }));
    expect(historical.customerFacingPrice).toBe(EXTREME_FENCE_SUBTOTAL);
    expect(historical.risk.emergency).toBe(false);
  });

  test('simulation scenario metadata and transcript generation remain strictly nonfinancial', () => {
    expect(stableStringify(scenarios)).not.toMatch(
      /\b(?:price|pricing|cost|rate|charge|fee|markup|margin|tax|overhead|permitAmount)\b/i
    );
    const scenario = pipeline.withDeterministicSeed('nonfinancial-transcript', function () {
      return pipeline.generateScenario('fence', 'Avery Smith');
    });
    const transcript = pipeline.withDeterministicSeed('nonfinancial-transcript', function () {
      return pipeline.generateTranscript(scenario);
    });
    expect(stableStringify(transcript)).not.toMatch(/\$|\b\d+(?:\.\d+)?\s*(?:dollars?|cents?)\b/i);
  });

  test('uses one customer-only clause-local emergency classifier in simulation and live processing', () => {
    expect(detectEmergencyEvidence([{ speaker: 'agent', text: 'Is this an emergency?' }]).isEmergency).toBe(false);
    expect(detectEmergencyEvidence([{ speaker: 'customer', text: 'There is no leak and no flood.' }]).isEmergency).toBe(false);
    expect(detectEmergencyEvidence([{ speaker: 'customer', text: 'The old leak was repaired; it has not returned.' }]).isEmergency).toBe(false);
    expect(detectEmergencyEvidence([{ speaker: 'customer', text: "This isn't an emergency, but water is flooding the basement right now." }]).isEmergency).toBe(true);

    const transcript = [{ speaker: 'customer', text: 'The pipe burst and water is pouring right now.' }];
    expect(pipeline.selectAction(transcript, 'Avery Smith', {}).action).toBe('Dispatch immediately');
    expect(eventIntelligence.detectEmergency(transcript[0].text, 'customer')).toMatchObject({
      type: 'emergency_detected', severity: 'high',
    });
    expect(eventIntelligence.detectEmergency('The pipe burst and water is pouring right now.', 'agent')).toBeNull();

    eventIntelligence.handleTranscriptSegment({
      sessionId: 'canonical-live-emergency',
      data: { speaker: 'customer', text: transcript[0].text },
    });
    expect(eventIntelligence.getSessionGuidance('canonical-live-emergency'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'emergency_detected' })]));
    eventIntelligence.clearSessionGuidance('canonical-live-emergency');
  });

  test('demo and live adapters are byte-equivalent for identical normalized input', () => {
    const simulation = fenceInput({
      transcript: [{ turnId: 'same-turn', speaker: 'customer', text: 'I need a 100-foot cedar fence.' }],
    });
    const live = fenceInput({
      transcript: [{ turnId: 'same-turn', role: 'customer', utterance: 'I need a 100-foot cedar fence.' }],
    });
    const simulationInput = adaptSimulationInput(simulation);
    const liveInput = adaptLiveInput(live);
    expect(stableStringify(simulationInput)).toBe(stableStringify(liveInput));
    expect(stableStringify(calculateCanonicalPolaris(simulationInput)))
      .toBe(stableStringify(calculateCanonicalPolaris(liveInput)));
  });

  test('returns immutable historical payload values without recalculating them', () => {
    const historical = {
      calculationVersion: 'm19-part3-canonical-v1',
      normalizedInputFingerprint: 'a'.repeat(64),
      businessProfileInputVersion: 'org-profile-v1',
      businessProfileInputHash: 'd'.repeat(64),
      customerFacingPrice: 4321,
      pricingLineItems: [{ code: 'historical', customerCharge: 4321 }],
    };
    const before = stableStringify(historical);
    const read = readHistoricalSnapshot(historical);
    expect(read).toEqual(historical);
    expect(read.calculationVersion).not.toBe(CALCULATION_VERSION);
    expect(stableStringify(historical)).toBe(before);
    read.customerFacingPrice = 9999;
    expect(historical.customerFacingPrice).toBe(4321);
  });
});
