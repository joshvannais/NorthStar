'use strict';

const { prepareBusinessProfileForWrite } = require('../../src/services/businessProfileAdapter');

function validProfile() {
  return {
    company: {
      name: '  Acme <literal> Caf\u00e9  ',
      dba: '  Acme Home Services  ',
      email: 'dispatch@example.com',
      phone: '  +1 (555) 010-0200  ',
      website: 'https://example.com/about?source=profile',
      logo: 'https://example.com/logo.svg',
      taxId: '',
      timeZone: 'America/New_York',
      currency: 'USD',
    },
    headquarters: {
      street: '  10 Main St  ',
      city: 'Boston',
      state: 'MA',
      zip: '02108',
      country: 'US',
      latitude: 42.3601,
      longitude: -71.0589,
      additionalOffices: [{
        id: 'office-north',
        name: '  North <Office>  ',
        street: '20 North St',
        city: 'Lowell',
        state: 'MA',
        zip: '01852',
        country: 'US',
        latitude: null,
        longitude: null,
      }],
    },
    serviceArea: {
      maxRadiusMiles: 75,
      maxTravelMinutes: 90,
      primaryTerritory: '  Greater Boston\nNorth Shore  ',
      polygon: [[42.1, -71.4], [42.7, -71.4], [42.7, -70.7]],
    },
    hours: {
      monday: {
        open: '08:00', close: '17:00', lunch: '12:00-13:00',
        emergency: false, afterHours: true, holiday: false,
      },
      sunday: {
        open: '', close: '', lunch: '', emergency: true, afterHours: true, holiday: false,
      },
      holidays: [{
        id: 'holiday-2026-12-25',
        name: '  Winter <Holiday>  ',
        date: '2026-12-25',
        closed: true,
        open: '',
        close: '',
      }, {
        id: 'holiday-2026-12-24',
        name: 'Christmas Eve',
        date: '2026-12-24',
        closed: false,
        open: '08:00',
        close: '12:00',
      }],
    },
    policies: {
      warranty: '  Written terms <b>control</b>.  ',
      cancellation: 'Cancel before dispatch.\nNo hidden rewrite.',
    },
    canonicalPricing: {},
    canonicalCosts: {},
  };
}

describe('Mission 20 Part 2C canonical company and operating profile contract', () => {
  test('accepts the established identity, locations, service area, hours, holidays, and policy shape byte-exact', () => {
    const source = validProfile();
    const prepared = prepareBusinessProfileForWrite(source);

    expect(prepared.errors).toEqual([]);
    expect(prepared.profile.company.name).toBe(source.company.name);
    expect(prepared.profile.headquarters.additionalOffices[0].name)
      .toBe(source.headquarters.additionalOffices[0].name);
    expect(prepared.profile.serviceArea.primaryTerritory).toBe(source.serviceArea.primaryTerritory);
    expect(prepared.profile.hours.holidays[0].name).toBe(source.hours.holidays[0].name);
    expect(prepared.profile.policies).toEqual(source.policies);
  });

  test.each([
    ['company field containment', (profile) => { profile.company.unowned = 'value'; }, 'company.unowned is not a supported company field'],
    ['company name', (profile) => { profile.company.name = '   '; }, 'company.name must not be blank'],
    ['company email', (profile) => { profile.company.email = 'not-an-email'; }, 'company.email must be a valid email address'],
    ['company website', (profile) => { profile.company.website = 'javascript:alert(1)'; }, 'company.website must use http or https'],
    ['company time zone', (profile) => { profile.company.timeZone = 'Mars/Olympus'; }, 'company.timeZone must be an IANA time zone'],
    ['company currency', (profile) => { profile.company.currency = 'usd'; }, 'company.currency must be a three-letter uppercase currency code'],
    ['headquarters coordinates', (profile) => { profile.headquarters.longitude = null; }, 'headquarters latitude and longitude must be configured together'],
    ['location field containment', (profile) => { profile.headquarters.additionalOffices[0].role = 'owner'; }, 'headquarters.additionalOffices[0].role is not a supported location field'],
    ['location identifier', (profile) => { profile.headquarters.additionalOffices[0].id = 'bad id'; }, 'headquarters.additionalOffices[0].id must be a stable identifier'],
    ['duplicate location identifier', (profile) => { profile.headquarters.additionalOffices.push({ ...profile.headquarters.additionalOffices[0] }); }, 'headquarters.additionalOffices contains duplicate id office-north'],
    ['service radius', (profile) => { profile.serviceArea.maxRadiusMiles = 0; }, 'serviceArea.maxRadiusMiles must be a finite number between 1 and 500'],
    ['service polygon', (profile) => { profile.serviceArea.polygon = [[42, -71], [99, -71], [43, -70]]; }, 'serviceArea.polygon[1] latitude must be between -90 and 90'],
    ['hours field containment', (profile) => { profile.hours.monday.timeZone = 'UTC'; }, 'hours.monday.timeZone is not a supported hours field'],
    ['hours pair', (profile) => { profile.hours.monday.close = ''; }, 'hours.monday open and close must be configured together'],
    ['hours lunch', (profile) => { profile.hours.monday.lunch = 'noon'; }, 'hours.monday.lunch must be empty or use HH:mm-HH:mm'],
    ['holiday date', (profile) => { profile.hours.holidays[0].date = '2026-02-30'; }, 'hours.holidays[0].date must be a real YYYY-MM-DD date'],
    ['holiday hours', (profile) => { profile.hours.holidays[1].close = ''; }, 'hours.holidays[1] open and close must be configured together'],
    ['duplicate holiday identifier', (profile) => { profile.hours.holidays[1].id = profile.hours.holidays[0].id; }, 'hours.holidays contains duplicate id holiday-2026-12-25'],
    ['policy value', (profile) => { profile.policies.warranty = { text: 'nested' }; }, 'policies.warranty must be a string'],
  ])('rejects invalid %s before persistence', (_label, mutate, expected) => {
    const source = validProfile();
    mutate(source);

    expect(prepareBusinessProfileForWrite(source).errors.join('\n')).toContain(expected);
  });
});
