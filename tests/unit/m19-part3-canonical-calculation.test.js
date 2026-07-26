'use strict';

const catalog = require('../../src/routes/simulation/service-catalog');
const pipeline = require('../../src/routes/simulation/pipeline');
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

const IDS = Object.freeze({
  organizationId: '00000000-0000-0000-0000-000000000001',
  customerId: '10000000-0000-0000-0000-000000000001',
  opportunityId: '20000000-0000-0000-0000-000000000001',
});

function profile(overrides) {
  return {
    version: 'bp-fixture-v1',
    company: { currency: 'USD' },
    crew: { defaultCrewSize: 2, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
    financial: { markup: 1.3, emergencyMarkup: 1.5, travelCharge: 0.58 },
    services: [],
    ...(overrides || {}),
  };
}

function fenceInput(overrides) {
  return {
    ...IDS,
    calculationVersion: CALCULATION_VERSION,
    service: {
      key: 'fence',
      scope: {
        jobType: 'replace',
        linearFeet: 100,
        material: 'cedar',
        height: 6,
        removalRequired: true,
        gates: [{ type: 'walk', width: 4 }],
        permitsRequired: true,
        schedulingPreference: 'weekday morning',
      },
    },
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
    businessProfile: profile(),
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    travel: null,
    callDurationSeconds: 242,
    actualCrewAssignment: null,
    ...(overrides || {}),
  };
}

describe('Mission 19 Part 3 canonical calculation contract', () => {
  test('normalizes Business Profile once without activating legacy pricing knobs', () => {
    const first = adaptBusinessProfile(profile(), 'bp-fixture-v1');
    const second = adaptBusinessProfile(JSON.parse(JSON.stringify(profile())), 'bp-fixture-v1');
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(second.hash);
    expect(first.pricing).toMatchObject({
      customerMarkupPercent: null,
      travelCustomerChargePerMile: null,
      emergencyMultiplier: null,
      legacyCatalogMarkupMultiplier: 1.3,
      legacyTravelChargePerMile: 0.58,
      legacyEmergencyMultiplier: 1.5,
    });
  });

  test('freezes the audited 100-foot cedar/removal/walk-gate customer price', () => {
    const result = calculateCanonicalPolaris(fenceInput());
    expect(result.customerFacingPrice).toBe(4510);
    expect(result.preliminaryRange).toEqual({ low: 3834, high: 5187 });
    expect(result.pricingLineItems.map(item => item.customerCharge)).toEqual([1800, 1200, 400, 350, 350, 410]);
    expect(result.materialsCharge).toBe(1800);
    expect(result.laborCharge).toBe(1200);
    expect(result.knownDirectMaterialCost).toBeNull();
    expect(result.knownInternalLaborCost).toBeNull();
    expect(result.knownDirectCosts).toBeNull();
    expect(result.grossProfit).toBeNull();
    expect(result.netProfit).toBeNull();
    expect(result.risk.emergency).toBe(false);
    expect(result.supportingTranscriptFactIds).toEqual([
      'fact-gate', 'fact-linear-feet', 'fact-material', 'fact-removal',
    ]);
    expect(stableStringify(result)).not.toMatch(/NaN|Infinity/);
  });

  test.each([
    ['fence', { jobType: 'replace', linearFeet: 100, material: 'cedar', removalRequired: true, gates: [{ type: 'walk' }] }, 4510],
    ['roofing', { jobType: 'replace', squares: 20, material: 'architectural', existingLayers: 1 }, 10505],
    ['hvac', { jobType: 'replace', tonnage: 3, systemType: 'central', seer: 14, sqft: 2000, ductworkReplace: false, thermostat: 'standard' }, 6950],
    ['plumbing', { jobType: 'repair', fixture: 'sink' }, 129],
    ['electrical', { jobType: 'repair', symptoms: 'tripping breaker' }, 149],
    ['concrete', { jobType: 'install', squareFeet: 400, finish: 'standard', existingRemoval: false, reinforcement: false }, 5280],
  ])('preserves current %s catalog price', (serviceKey, scope, expected) => {
    const rawCatalog = catalog[serviceKey].pricing.calculate(scope);
    const result = calculateCanonicalPolaris(fenceInput({ service: { key: serviceKey, scope }, facts: [] }));
    expect(rawCatalog.total).toBe(expected);
    expect(result.customerFacingPrice).toBe(expected);
  });

  test('does not price missing, unsupported, or contradictory scope', () => {
    const missing = calculateCanonicalPolaris(fenceInput({
      service: { key: 'fence', scope: { jobType: 'replace', material: 'cedar' } },
    }));
    expect(missing.customerFacingPrice).toBeNull();
    expect(missing.service.unpricedReason).toContain('linearFeet');

    const unsupported = calculateCanonicalPolaris(fenceInput({
      service: { key: 'fence', scope: { jobType: 'replace', linearFeet: 100, material: 'mystery composite' } },
    }));
    expect(unsupported.customerFacingPrice).toBeNull();
    expect(unsupported.service.unpricedReason).toContain('supported material');

    const conflicting = calculateCanonicalPolaris(fenceInput({
      facts: [{ id: 'fact-conflict', variable: 'linearFeet', status: 'conflicting', normalizedValue: null }],
    }));
    expect(conflicting.customerFacingPrice).toBeNull();
    expect(conflicting.risk.contradictoryFactIds).toEqual(['fact-conflict']);
  });

  test('keeps charge, cost, gross-profit, overhead, and net-profit semantics separate', () => {
    const result = calculateCanonicalPolaris(fenceInput({
      businessProfile: profile({
        crew: { defaultCrewSize: 2, averageHourlyRate: 25, overtimeMultiplier: 1.5 },
        canonicalPricing: { customerMarkupPercent: 10, travelCustomerChargePerMile: 0.5 },
        canonicalCosts: { overheadPercent: 10, travelCostPerMile: 0.2 },
      }),
      service: {
        key: 'fence',
        scope: {
          jobType: 'replace', linearFeet: 100, material: 'cedar', removalRequired: true,
          gates: [{ type: 'walk' }], laborHours: 4,
        },
      },
      travel: { distanceMiles: 10, minutes: 20, source: 'configured-route' },
      costSettings: { materialCost: 900 },
    }));
    expect(result.customerFacingPrice).toBe(4966);
    expect(result.travel.customerCharge).toBe(5);
    expect(result.knownInternalLaborCost).toBe(200);
    expect(result.travel.knownInternalCost).toBe(2);
    expect(result.knownDirectCosts).toBe(1102);
    expect(result.grossProfit).toBe(3864);
    expect(result.overhead).toBe(110.2);
    expect(result.netProfit).toBe(3753.8);
  });

  test('applies emergency pricing only for explicit configuration and current customer evidence', () => {
    const currentEmergency = [{ turnId: 'e1', speaker: 'customer', text: 'There is water flooding the room right now.' }];
    const legacyOnly = calculateCanonicalPolaris(fenceInput({ transcript: currentEmergency }));
    expect(legacyOnly.customerFacingPrice).toBe(4510);

    const configured = calculateCanonicalPolaris(fenceInput({
      transcript: currentEmergency,
      pricingSettings: { emergencyMultiplier: 1.5 },
    }));
    expect(configured.customerFacingPrice).toBe(6765);
    expect(configured.risk).toMatchObject({ emergency: true, signal: 'active flooding' });

    const historical = calculateCanonicalPolaris(fenceInput({
      transcript: [{ speaker: 'customer', text: 'It flooded yesterday, but it was fixed and is fine now.' }],
      pricingSettings: { emergencyMultiplier: 1.5 },
    }));
    expect(historical.customerFacingPrice).toBe(4510);
    expect(historical.risk.emergency).toBe(false);
  });

  test('uses one customer-only clause-local classifier in simulation and live processing', () => {
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

  test('demo and real adapters are byte-equivalent for identical normalized input', () => {
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
      calculationVersion: 'm19-part3-canonical-v0',
      normalizedInputFingerprint: 'a'.repeat(64),
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
