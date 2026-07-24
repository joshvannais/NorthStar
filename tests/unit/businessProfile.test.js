'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const originalDataDir = process.env.NORTHSTAR_DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-business-profile-'));
fs.copyFileSync(
  path.resolve(__dirname, '../../data/business-profile.json'),
  path.join(testDataDir, 'business-profile.json')
);
process.env.NORTHSTAR_DATA_DIR = testDataDir;

const {
  getProfile,
  updateProfile,
  validateProfile,
  getCompany,
  getHeadquarters,
  getServiceArea,
  getRoutingPreferences,
  getBusinessHours,
  getCrewDefaults,
  getVehicles,
  getServiceCatalog,
  getFinancialDefaults,
  getSchedulingDefaults,
  getPolarisPreferences,
  getRetellPreferences,
  getNotificationPreferences,
  getIntegrations,
  updateSection,
} = require('../../src/services/businessProfile');

afterAll(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.NORTHSTAR_DATA_DIR;
  else process.env.NORTHSTAR_DATA_DIR = originalDataDir;
});

// ====================================================================
// getProfile
// ====================================================================

describe('getProfile', () => {
  test('returns a full profile object', () => {
    const profile = getProfile();
    expect(profile).toBeDefined();
    expect(profile.company).toBeDefined();
    expect(profile.company.name).toBeDefined();
    expect(profile.crew).toBeDefined();
    expect(profile.financial).toBeDefined();
    expect(profile.scheduling).toBeDefined();
  });

  test('returns a deep clone (mutating returned object does not affect cache)', () => {
    const a = getProfile();
    const b = getProfile();
    a.company.name = 'MODIFIED';
    expect(b.company.name).not.toBe('MODIFIED');
  });

  test('crew section has expected defaults', () => {
    const profile = getProfile();
    expect(profile.crew.defaultCrewSize).toBe(2);
    expect(profile.crew.averageHourlyRate).toBe(42);
    expect(profile.crew.overtimeMultiplier).toBe(1.5);
  });

  test('financial section has expected defaults', () => {
    const profile = getProfile();
    expect(profile.financial.desiredGrossMargin).toBe(40);
    expect(profile.financial.desiredNetMargin).toBe(20);
    expect(profile.financial.taxRate).toBe(7);
  });

  test('serviceArea has expected structure', () => {
    const profile = getProfile();
    expect(profile.serviceArea.maxRadiusMiles).toBe(50);
    expect(profile.serviceArea.maxTravelMinutes).toBe(60);
  });

  test('polaris preferences exist', () => {
    const profile = getProfile();
    expect(profile.polaris.responseStyle).toBe('executive');
  });
});

// ====================================================================
// Sectional getters
// ====================================================================

describe('sectional getters', () => {
  test('getCrewDefaults returns crew section', () => {
    const crew = getCrewDefaults();
    expect(crew.defaultCrewSize).toBe(2);
    expect(crew.averageHourlyRate).toBe(42);
  });

  test('getFinancialDefaults returns financial section', () => {
    const financial = getFinancialDefaults();
    expect(financial.desiredGrossMargin).toBe(40);
    expect(financial.markup).toBe(1.3);
  });

  test('getSchedulingDefaults returns scheduling section', () => {
    const scheduling = getSchedulingDefaults();
    expect(scheduling.maxJobsPerDay).toBe(4);
    expect(scheduling.workDayLength).toBe(8);
  });

  test('getCompany returns company section', () => {
    const company = getCompany();
    expect(company.name).toBeDefined();
  });

  test('getHeadquarters returns headquarters section', () => {
    const hq = getHeadquarters();
    expect(hq.country).toBe('US');
  });

  test('getServiceArea returns service area', () => {
    const area = getServiceArea();
    expect(area.maxRadiusMiles).toBe(50);
  });

  test('getRoutingPreferences returns routing section', () => {
    const routing = getRoutingPreferences();
    expect(routing.preferredProvider).toBe('google-maps');
    expect(routing.trafficEnabled).toBe(true);
  });

  test('getBusinessHours returns hours section', () => {
    const hours = getBusinessHours();
    expect(hours).toBeDefined();
  });

  test('getVehicles returns vehicles section', () => {
    const vehicles = getVehicles();
    expect(vehicles.truckCount).toBe(3);
  });

  test('getServiceCatalog returns services array', () => {
    const services = getServiceCatalog();
    expect(Array.isArray(services)).toBe(true);
  });

  test('getPolarisPreferences returns polaris section', () => {
    const polaris = getPolarisPreferences();
    expect(polaris.responseStyle).toBe('executive');
  });

  test('getRetellPreferences returns retell section', () => {
    const retell = getRetellPreferences();
    expect(retell.voicePersonality).toBe('professional');
  });

  test('getNotificationPreferences returns notifications section', () => {
    const notif = getNotificationPreferences();
    expect(notif.email).toBe(true);
  });

  test('getIntegrations returns integrations section', () => {
    const integrations = getIntegrations();
    expect(integrations).toBeDefined();
  });
});

// ====================================================================
// validateProfile
// ====================================================================

describe('validateProfile', () => {
  test('valid profile passes', () => {
    const profile = getProfile();
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  test('missing company section fails', () => {
    const profile = getProfile();
    delete profile.company;
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Company'))).toBe(true);
  });

  test('missing crew section fails', () => {
    const profile = getProfile();
    delete profile.crew;
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });

  test('missing financial section fails', () => {
    const profile = getProfile();
    delete profile.financial;
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });

  test('defaultCrewSize < 1 fails', () => {
    const profile = getProfile();
    profile.crew.defaultCrewSize = 0;
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });

  test('maxCrewSize < defaultCrewSize fails', () => {
    const profile = getProfile();
    profile.crew.defaultCrewSize = 5;
    profile.crew.maxCrewSize = 3;
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });

  test('invalid gross margin fails', () => {
    const profile = getProfile();
    profile.financial.desiredGrossMargin = 150;
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });
});

// ====================================================================
// updateProfile & updateSection
// ====================================================================

describe('updateProfile', () => {
  test('valid update succeeds', () => {
    const original = getProfile();
    const updated = { ...original, company: { ...original.company, name: 'Test Co' } };
    const result = updateProfile(updated);
    expect(result.success).toBe(true);
    expect(result.profile.company.name).toBe('Test Co');

    // Restore
    updateProfile(original);
  });

  test('invalid update returns errors', () => {
    const result = updateProfile({});
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('updateSection', () => {
  test('valid section update succeeds', () => {
    const original = getProfile();
    const result = updateSection('company', { name: 'Section Test' });
    expect(result.success).toBe(true);

    // Restore
    updateProfile(original);
  });

  test('unknown section fails', () => {
    const result = updateSection('nonexistent', {});
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('does not exist');
  });
});
