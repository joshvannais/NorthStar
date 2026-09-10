'use strict';

const fields = require('../../public/js/profile-structured-fields');
const {
  canonicalFenceProfile
} = require('../helpers/m19-part3-business-profile');
const {
  prepareBusinessProfileForWrite
} = require('../../src/services/businessProfileAdapter');
describe('structured business settings respect existing saved shapes', () => {
  test.each([undefined, {}, {
    'fence:cedar': 0
  }, {
    'service:custom:pine': 12
  }])('material cost configuration %p remains distinguishable', v => {
    expect(fields.validate('material', v)).toBe('');
  });
  test('material references split against actual service names and retain unknown service references', () => {
    expect(fields.splitMaterial('service:custom:pine', [{
      id: 'service'
    }, {
      id: 'SERVICE:CUSTOM'
    }])).toEqual({
      service: 'service:custom',
      material: 'pine'
    });
    expect(fields.splitMaterial('unknown:service:cedar', [])).toEqual({
      service: 'unknown:service',
      material: 'cedar'
    });
  });
  test.each([undefined, [], [[0, 0], [0, 1], [1, 1]], [{
    latitude: 0,
    longitude: 0
  }, {
    latitude: 0,
    longitude: 1
  }, {
    latitude: 1,
    longitude: 1
  }]])('preserves supported boundary representation %p', v => {
    expect(fields.validate('polygon', v)).toBe('');
  });
  test('boundary and costs reject invalid numeric values without silently clearing them', () => {
    expect(fields.validate('polygon', [[0, 0]])).toMatch(/at least three/);
    expect(fields.shape('polygon', [[91, 0]])).toBe(false);
    expect(fields.shape('equipment', {
      digger: -1
    })).toBe(false);
    expect(fields.shape('material', {
      'fence:cedar': '12'
    })).toBe(false);
  });
  test('all four pricing types use the existing server contract', () => {
    const profile = canonicalFenceProfile();
    expect(new Set(profile.services[0].canonicalPricing.lineItems.map(x => x.type)).size).toBe(4);
    expect(fields.validate('pricing', profile.services[0].canonicalPricing)).toBe('');
    expect(prepareBusinessProfileForWrite(profile).errors).toEqual([]);
  });
  test('unknown fields and malformed records remain unresolved instead of being dropped', () => {
    for (const value of [{
      futureSetting: {
        keep: 1
      }
    }, {
      lineItems: [{
        code: 'saved',
        label: 'Saved',
        category: 'labor',
        type: 'futureType'
      }]
    }, null, [], {
      rangePercent: '10'
    }]) expect(fields.shape('pricing', value)).toBe(false);
  });
  test('exact condition shapes retain typed and nested values allowed by existing calculation', () => {
    for (const equal of [null, false, 0, '0', [1, false], {
      grade: 'A',
      sizes: [1, 2]
    }]) {
      const profile = canonicalFenceProfile();
      profile.services[0].canonicalPricing.lineItems[0].when = {
        field: 'customDetail',
        equals: equal
      };
      expect(fields.validate('pricing', profile.services[0].canonicalPricing)).toBe('');
      expect(prepareBusinessProfileForWrite(profile).errors).toEqual([]);
    }
  });
  test('missing required charge values and duplicate references block saving', () => {
    const p = canonicalFenceProfile().services[0].canonicalPricing;
    delete p.lineItems[0].unitRate;
    expect(fields.validate('pricing', p)).toMatch(/price per unit/);
    p.lineItems[0].unitRate = 0;
    p.lineItems[1].code = p.lineItems[0].code;
    expect(fields.validate('pricing', p)).toMatch(/different saved reference/);
  });
});
