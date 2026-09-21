'use strict';

const { safeTargets } = require('../../src/learning/externalMaterialReconciliationRepository');

describe('Mission 25 Part 11H material target presentation', () => {
  const digest = 'a'.repeat(64);

  test('returns exact safe company labels with opaque mappings', () => {
    expect(safeTargets([
      { targetReference: 'mulch-north', label: 'Cedar Mulch', digest },
      { targetReference: 'mulch-south', label: 'Pine Mulch', digest },
    ], 'targetReference')).toEqual([
      { targetReference: 'mulch-north', displayLabel: 'Cedar Mulch', digest },
      { targetReference: 'mulch-south', displayLabel: 'Pine Mulch', digest },
    ]);
  });

  test('fails closed for ambiguous or unsafe visible labels', () => {
    const values = [
      { targetReference: 'north', label: 'Wood Chips', digest },
      { targetReference: 'south', label: 'Wood Chips', digest },
      { targetReference: 'object', label: 'Crew [Object Object] · Technician', digest },
      { targetReference: 'phone', label: 'Supplier 860-555-1212', digest },
      { targetReference: 'digest', label: `Material ${'b'.repeat(64)}`, digest },
      { targetReference: 'safe', label: 'Screened Topsoil', digest },
    ];
    expect(safeTargets(values, 'targetReference')).toEqual([
      { targetReference: 'safe', displayLabel: 'Screened Topsoil', digest },
    ]);
  });

  test('checks uniqueness after the exact normalization shown by the browser', () => {
    expect(safeTargets([
      { targetReference: 'one', label: 'Regional.North', digest },
      { targetReference: 'two', label: 'Ｒｅｇｉｏｎａｌ．Ｎｏｒｔｈ', digest },
      { targetReference: 'three', label: 'Regional-North', digest },
    ], 'targetReference')).toEqual([
      { targetReference: 'three', displayLabel: 'Regional-North', digest },
    ]);
  });
});
