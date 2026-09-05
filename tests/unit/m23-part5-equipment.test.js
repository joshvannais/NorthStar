'use strict';
const contract = require('../../src/equipment/contract');
describe('Mission 23 Part 5 exact equipment contracts', () => {
  test('asks one missing identifier at a time without category inference', () => {
    expect(contract.nextQuestion({})).toMatchObject({ field: 'manufacturer' });
    expect(contract.nextQuestion({ manufacturer: 'Ford' })).toMatchObject({ field: 'model' });
    expect(contract.publicIdentity({ manufacturer: 'Ford', attachments: 'Private plow', accessType: 'owned' }))
      .toEqual({ manufacturer: 'Ford', model: 'unknown', modelYear: 'unknown', series: 'unknown', engine: 'unknown', configuration: 'unknown' });
  });
  test.each(['\u202Ehidden', '\u0000', '\u2060', '\uFFF9', '\ud800', 'e\u0301', ' trailing '])('rejects ambiguous text %j', value => {
    expect(() => contract.text(value)).toThrow();
  });
  test.each(['Équipement', '林業機械', 'Camión', 'Ford F-350'])('preserves ordinary international text %j', value => {
    expect(contract.text(value)).toBe(value);
  });
  test('does not accept AI-invented model or capability', () => {
    const fields = { manufacturer: 'Ford', model: 'F-350', modelYear: null, series: null, engine: null, configuration: null };
    expect(contract.literalIdentifiers(fields, 'add a Ford F-350 for hauling')).toEqual({ manufacturer: 'Ford', model: 'F-350' });
    expect(() => contract.literalIdentifiers({ ...fields, engine: '6.7 diesel' }, 'add a Ford F-350')).toThrow();
    expect(() => contract.literalIdentifiers({ ...fields, towingCapacity: '15000' }, 'add a Ford F-350')).toThrow();
  });
  test('requires explicit version-bound confirmation and excludes tenant authority fields', () => {
    const body = { action: 'confirm', expectedRevision: 1, expectedDigest: 'a'.repeat(64), confirmation: 'save_reviewed_asset' };
    expect(contract.normalizeDraftAction(body)).toBe(body);
    for (const patch of [{ confirmation: true }, { expectedDigest: null }, { actor: 'owner' }, { answer: 'yes' }]) {
      expect(() => contract.normalizeDraftAction({ ...body, ...patch })).toThrow();
    }
  });
  test('only public exact configuration participates in reusable research identity', () => {
    const fields = { manufacturer: 'Ford', model: 'F-350', modelYear: '2024', series: 'XL', engine: '7.3 V8', configuration: '4x4 regular cab' };
    expect(contract.hash(contract.publicIdentity(fields))).toBe(contract.hash(contract.publicIdentity({ ...fields, attachments: 'Private plow', vin: 'private', hours: 200, condition: 'damaged' })));
    expect(contract.hash(contract.publicIdentity(fields))).not.toBe(contract.hash(contract.publicIdentity({ ...fields, modelYear: '2023' })));
  });
});
