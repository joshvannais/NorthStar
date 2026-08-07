'use strict';

const { prepareBusinessProfileForWrite } = require('../../src/services/businessProfileAdapter');

function profileWith(services) {
  return { canonicalPricing: {}, canonicalCosts: {}, services };
}

function validPricing() {
  return {
    requiredScope: ['linearFeet', 'material', 'permitsRequired'],
    allowedScopeValues: {
      material: ['cedar', 'pine'],
      permitsRequired: [true, false],
    },
    rangePercent: 0,
    lineItems: [
      {
        code: 'permit',
        label: 'Permit <review> "raw"',
        category: 'serviceCharge',
        type: 'fixed',
        amount: 0,
        when: { field: 'permitsRequired', equals: true },
      },
      {
        code: 'labor',
        label: 'Labor per foot',
        category: 'labor',
        type: 'perUnit',
        quantityField: 'linearFeet',
        unitRate: 0,
      },
      {
        code: 'material',
        label: 'Material per foot',
        category: 'materials',
        type: 'perUnitByValue',
        quantityField: 'linearFeet',
        selectorField: 'material',
        unitRates: { cedar: 0, pine: 1.25 },
      },
      {
        code: 'gates',
        label: 'Gate items',
        category: 'equipment',
        type: 'perItemByValue',
        collectionField: 'gates',
        selectorField: 'type',
        unitRates: { walk: 0 },
      },
    ],
  };
}

describe('Mission 20 Part 2D normalized service catalogue', () => {
  test('preserves canonical service and pricing bytes including explicit zero', () => {
    const service = {
      id: 'fence-installation',
      name: 'Fence <Install> "North"',
      description: 'Raw \u2603 description',
      active: true,
      crewSize: 2,
      avgHours: 2.5,
      difficulty: 1.2,
      confidence: 0,
      equipment: 'Mini-excavator <A&B>',
      legacyNote: 'preserve unknown legacy metadata',
      canonicalPricing: validPricing(),
    };
    const result = prepareBusinessProfileForWrite(profileWith([service]));
    expect(result.errors).toEqual([]);
    expect(result.migratedFields).toEqual([]);
    expect(result.profile.services[0]).toEqual(service);
  });

  test('assigns deterministic stable ids to legacy id-less services without rewriting their values', () => {
    const legacy = [
      { name: 'Tree Removal \u2603', equipment: '<img src=x>', difficulty: 1.3 },
      { name: 'Tree Removal \u2603', equipment: 'Second raw value', difficulty: 1.1 },
    ];
    const first = prepareBusinessProfileForWrite(profileWith(legacy));
    const second = prepareBusinessProfileForWrite(profileWith(legacy));
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(first.profile.services.map((service) => service.id)).toEqual(
      second.profile.services.map((service) => service.id)
    );
    expect(first.profile.services.map((service) => service.id)).toEqual([
      expect.stringMatching(/^service-[0-9a-f]{16}$/),
      expect.stringMatching(/^service-[0-9a-f]{16}$/),
    ]);
    expect(new Set(first.profile.services.map((service) => service.id)).size).toBe(2);
    expect(first.profile.services.map((service) => ({
      name: service.name,
      equipment: service.equipment,
      difficulty: service.difficulty,
    }))).toEqual(legacy);
    expect(first.migratedFields).toEqual(['services[0].id', 'services[1].id']);
  });

  test.each([
    [[null], 'services[0] must be an object'],
    [[{ id: 'bad id', name: 'Fence' }], 'services[0].id must be a stable identifier'],
    [[{ id: 'Fence', name: 'One' }, { id: 'fence', name: 'Two' }], 'duplicate stable id'],
    [[{ id: 'fence', name: '   ' }], 'services[0].name must not be blank'],
    [[{ id: 'fence', name: 'Fence', crewSize: 0 }], 'services[0].crewSize must be a positive integer'],
    [[{ id: 'fence', name: 'Fence', avgHours: -1 }], 'services[0].avgHours must be a positive finite number'],
    [[{ id: 'fence', name: 'Fence', confidence: 101 }], 'services[0].confidence must be between 0 and 100'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { surprise: true } }], 'is not a supported pricing field'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { requiredScope: ['feet', 'feet'], lineItems: [] } }], 'duplicate required scope field'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { allowedScopeValues: { material: [] }, lineItems: [] } }], 'must be a non-empty array'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { rangePercent: 101, lineItems: [] } }], 'rangePercent must be between 0 and 100'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { lineItems: [{ code: 'same', label: 'One', category: 'labor', type: 'fixed', amount: 1 }, { code: 'same', label: 'Two', category: 'labor', type: 'fixed', amount: 2 }] } }], 'duplicate line item code'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { lineItems: [{ code: 'bad', label: 'Bad', category: 'labor', type: 'perUnit' }] } }], 'quantityField is required for perUnit'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { lineItems: [{ code: 'bad', label: 'Bad', category: 'labor', type: 'perUnitByValue', quantityField: 'feet', selectorField: 'material', unitRates: { Cedar: 1 } }] } }], 'unitRates keys must be lowercase'],
    [[{ id: 'fence', name: 'Fence', canonicalPricing: { lineItems: [{ code: 'bad', label: 'Bad', category: 'unknown', type: 'fixed', amount: 1 }] } }], 'category must be one of'],
  ])('rejects malformed catalogue authority without persistence (%#)', (services, expected) => {
    const result = prepareBusinessProfileForWrite(profileWith(services));
    expect(result.profile).toBeNull();
    expect(result.errors.join('\n')).toContain(expected);
  });
});
