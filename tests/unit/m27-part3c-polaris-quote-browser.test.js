'use strict';

const path = require('node:path');

describe('Mission 27 Part 3C Polaris quote browser contract', () => {
  const modulePath = path.resolve(__dirname, '../../public/js/polaris-quote-journey.js');
  beforeEach(() => { delete require.cache[modulePath]; });

  test('converts exact USD decimal input without floating point arithmetic', () => {
    const journey = require(modulePath);
    expect(journey.exactMoney('0')).toEqual(expect.objectContaining({ minorUnits: '0',
      decimal: '0.00', exactZero: true }));
    expect(journey.exactMoney('10971.42')).toEqual(expect.objectContaining({
      minorUnits: '1097142', decimal: '10971.42', exactZero: false }));
    expect(journey.decimal({ minorUnits: '28148' })).toBe('281.48');
    expect(() => journey.exactMoney('10.001')).toThrow(/two decimal/);
    expect(() => journey.exactMoney('100000.01')).toThrow(/launch limit/);
  });

  test('keeps the mounted browser contract on shared authenticated fetch and named boundaries', () => {
    const source = require('node:fs').readFileSync(modulePath, 'utf8');
    expect(source).toContain('window.NorthStarAccountSession.fetch');
    expect(source).toContain('legal review is complete');
    expect(source).toContain('Mission 23 receiver exists');
    expect(source).toContain("review.simulated");
    expect(source).toContain("!confirm.checked||reason.value.trim().length<12");
    expect(source).not.toContain("reason.value.trim()||'Human reviewed");
    expect(source).not.toContain('window.fetch(');
    expect(source).not.toContain('automaticDelivery: true');
  });
});
